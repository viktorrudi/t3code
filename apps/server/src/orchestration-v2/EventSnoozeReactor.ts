import {
  CommandId,
  type PullRequestComment,
  type PullRequestThreadCommentsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { HttpClientRequest } from "effect/http";
import * as JiraClient from "../personal/JiraClient.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class JiraSnoozeReadError extends Schema.TaggedError<JiraSnoozeReadError>()(
  "JiraSnoozeReadError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return "Could not read Jira comments. Check the Jira snooze connection in Settings.";
  }
}

const JiraComments = Schema.Struct({
  comments: Schema.Array(Schema.Struct({ created: Schema.String })),
});

export class JiraSnoozeComments extends Context.Service<
  JiraSnoozeComments,
  {
    readonly latest: (issueKey: string) => Effect.Effect<string | null, JiraSnoozeReadError>;
  }
>()("t3/orchestration-v2/EventSnoozeReactor/JiraSnoozeComments") {}

const decodeJiraComments = Schema.decodeUnknownEffect(JiraComments);
const isJiraReadError = Schema.is(JiraSnoozeReadError);

const makeJiraComments = Effect.gen(function* () {
  const jira = yield* JiraClient.JiraClient;
  const latest = Effect.fn("JiraSnoozeComments.latest")(
    function* (issueKey: string) {
      const response = yield* jira.execute(
        HttpClientRequest.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`).pipe(
          HttpClientRequest.setUrlParams({ orderBy: "-created", maxResults: "1" }),
        ),
      );
      if (response.status !== 200) return yield* new JiraSnoozeReadError({});
      const page = yield* decodeJiraComments(response.body);
      return page.comments[0]?.created ?? null;
    },
    Effect.mapError((cause) =>
      isJiraReadError(cause) ? cause : new JiraSnoozeReadError({ cause }),
    ),
    Effect.timeout("25 seconds"),
    Effect.mapError((cause) =>
      isJiraReadError(cause) ? cause : new JiraSnoozeReadError({ cause }),
    ),
  );
  return { latest };
});
export const layerJiraComments = Layer.effect(JiraSnoozeComments, makeJiraComments).pipe(
  Layer.provide(JiraClient.layer),
);

function hasNewPullRequestReaction(
  comments: ReadonlyArray<PullRequestComment>,
  since: string,
): boolean {
  return comments.some(
    (comment) =>
      Date.parse(comment.createdAt) > Date.parse(since) &&
      (comment.kind !== "review" ||
        comment.reviewState?.toUpperCase() === "APPROVED" ||
        comment.body.trim().length > 0),
  );
}

export class EventSnoozeReactor extends Context.Service<
  EventSnoozeReactor,
  {
    readonly sweep: Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/EventSnoozeReactor") {}

/** @public */
export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const jira = yield* JiraSnoozeComments;
  const sweep = Effect.gen(function* () {
    const threads = yield* projections.getEventSnoozedThreads();
    const groups = new Map<string, (typeof threads)[number][]>();
    for (const thread of threads) {
      const condition = thread.snoozeCondition;
      if (condition == null || thread.snoozedAt == null) continue;
      const key =
        condition.kind === "jira"
          ? `jira ${condition.issueKey}`
          : `${thread.projectId} ${condition.pullRequest.host} ${condition.pullRequest.repository} ${condition.pullRequest.number}`;
      groups.set(key, [...(groups.get(key) ?? []), thread]);
    }
    yield* Effect.forEach(
      [...groups.values()],
      (targets) =>
        Effect.gen(function* () {
          const first = targets[0]!;
          const condition = first.snoozeCondition!;
          const comments: PullRequestComment[] = [];
          let jiraCreated: string | null = null;
          if (condition.kind === "jira") {
            jiraCreated = yield* jira.latest(condition.issueKey);
          } else {
            const reference = { projectId: first.projectId, ...condition.pullRequest };
            yield* pullRequests.invalidate({ reference });
            const activity = yield* pullRequests.activity(reference);
            comments.push(...activity.comments);
            for (const thread of activity.reviewThreads) {
              let cursor: string | null | undefined = thread.nextCommentsCursor;
              const seen = new Set<string>();
              while (cursor != null && !seen.has(cursor)) {
                seen.add(cursor);
                const page: PullRequestThreadCommentsResult = yield* pullRequests.threadComments({
                  ...reference,
                  threadId: thread.id,
                  cursor,
                });
                comments.push(
                  ...page.comments.map((comment) => ({
                    ...comment,
                    kind: "review-comment" as const,
                    path: thread.path,
                    reviewState: null,
                  })),
                );
                cursor = page.nextCursor;
              }
            }
          }
          for (const thread of targets) {
            const since = DateTime.formatIso(thread.snoozedAt!);
            const matched =
              condition.kind === "jira"
                ? jiraCreated !== null && Date.parse(jiraCreated) > Date.parse(since)
                : hasNewPullRequestReaction(comments, since);
            if (!matched) continue;
            yield* engine.dispatch({
              type: "thread.unsnooze",
              commandId: CommandId.make(
                `event-snooze:${thread.id}:${thread.snoozeRequestId ?? since}`,
              ),
              threadId: thread.id,
              reason: "event",
              snoozedAt: since,
              expectedSnoozeId: thread.snoozeRequestId ?? undefined,
            });
          }
        }).pipe(
          Effect.catch(() =>
            Effect.logWarning("event snooze check failed; keeping snooze", {
              kind: targets[0]?.snoozeCondition?.kind,
            }),
          ),
        ),
      { concurrency: 4, discard: true },
    );
  }).pipe(
    Effect.catch(() => Effect.logWarning("event snooze sweep failed; retrying next sweep")),
    Effect.withSpan("EventSnoozeReactor.sweep"),
  );
  const start = () =>
    forkParked(sweep.pipe(Effect.repeat(Schedule.spaced("2 minutes")), Effect.asVoid));
  return { sweep, start };
});
export const layer = Layer.effect(EventSnoozeReactor, make);
