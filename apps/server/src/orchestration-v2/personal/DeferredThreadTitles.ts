import type { OrchestrationV2StoredEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as EffectOutbox from "../EffectOutbox.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as ProjectStore from "../ProjectStore.ts";

export const isSensoneoProject = (title: string) =>
  /^sensoneo(?: frontend)?$/.test(title.trim().toLowerCase());

export const hasCompletedRun = (events: ReadonlyArray<OrchestrationV2StoredEvent>) =>
  events.some(
    ({ event }) =>
      (event.type === "run.created" || event.type === "run.updated") &&
      event.payload.status === "completed",
  );

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const outbox = yield* EffectOutbox.EffectOutboxV2;

  // Called inside the event sink's transaction so completion and title work survive together.
  return Effect.fn("DeferredThreadTitles.enqueue")(function* (
    events: ReadonlyArray<OrchestrationV2StoredEvent>,
  ) {
    const threadIds = new Set(
      events.flatMap(({ event }) =>
        (event.type === "run.created" || event.type === "run.updated") &&
        event.payload.status === "completed"
          ? [event.threadId]
          : [],
      ),
    );
    for (const threadId of threadIds) {
      const thread = yield* projections.getThread(threadId);
      const pending = thread.titleRegeneration;
      if (pending == null || thread.deletedAt !== null || thread.archivedAt !== null) continue;
      const project = yield* projects.get(thread.projectId);
      if (Option.isNone(project) || !isSensoneoProject(project.value.title)) continue;
      const initial = yield* outbox.get(`effect:${pending.requestId}:thread-title.generate`);
      if (
        Option.isNone(initial) ||
        initial.value.request.type !== "thread-title.generate" ||
        initial.value.request.kind.type !== "initial"
      )
        continue;
      yield* outbox.enqueue([
        {
          id: `effect:${pending.requestId}:thread-title.generate:after-first-turn`,
          commandId: pending.requestId,
          threadId,
          request: { type: "thread-title.generate", kind: { type: "regenerate" } },
        },
      ]);
    }
  });
});
