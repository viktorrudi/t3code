import type { EnvironmentId, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { projectThreadAwarenessV2, subagentAwaitsUser } from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";

export type PushCandidate = {
  readonly key: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
  readonly body: string;
  readonly phase: string;
  readonly deepLink: string;
  readonly eventAt: number;
  readonly question?: { readonly threadId: string; readonly requestId: string };
};

export function plainPreview(text: string): string {
  return Array.from(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/^[#>*\s-]+/gmu, "")
      .replace(/[`*_~]/gu, "")
      .replace(/\s+/gu, " ")
      .trim(),
  )
    .slice(0, 180)
    .join("");
}

export function notificationCandidates(
  environmentId: EnvironmentId,
  threads: ReadonlyMap<string, OrchestrationV2ThreadShell>,
  now: number,
): ReadonlyArray<PushCandidate> {
  const result: PushCandidate[] = [];
  const children = new Map<string, OrchestrationV2ThreadShell>();
  for (const child of threads.values()) {
    if (child.deletedAt || child.archivedAt || !subagentAwaitsUser(child)) continue;
    const root = child.lineage.rootThreadId;
    const previous = children.get(root);
    if (!previous || DateTime.isGreaterThan(child.updatedAt, previous.updatedAt))
      children.set(root, child);
  }
  for (const thread of threads.values()) {
    if (thread.deletedAt || thread.archivedAt) continue;
    const snoozedAt = thread.snoozedAt ? DateTime.toEpochMillis(thread.snoozedAt) : null;
    const pending = thread.pendingRuntimeRequest;
    const raisedHand =
      pending &&
      (pending.kind !== "user_input" ||
        snoozedAt === null ||
        DateTime.toEpochMillis(pending.createdAt) > snoozedAt);
    const completedAt = thread.latestRunCompletedAt
      ? DateTime.toEpochMillis(thread.latestRunCompletedAt)
      : null;
    const wokeOnError =
      thread.status === "failed" &&
      (snoozedAt === null || (completedAt !== null && completedAt > snoozedAt));
    if (
      (thread.snoozeCondition ||
        (thread.snoozedUntil && DateTime.toEpochMillis(thread.snoozedUntil) > now)) &&
      !raisedHand &&
      !children.has(thread.id) &&
      !wokeOnError &&
      !thread.pendingGuestMessageCount
    )
      continue;
    const child = children.get(thread.id);
    const state = projectThreadAwarenessV2({
      environmentId,
      project: { title: "" },
      thread,
      ...(child?.pendingRuntimeRequest
        ? {
            pendingSubagentRequest: {
              requestId: child.pendingRuntimeRequest.id,
              updatedAt: child.updatedAt,
              waitsForInput: child.pendingRuntimeRequest.kind === "user_input",
            },
          }
        : {}),
    });
    if (
      !state ||
      !["completed", "waiting_for_input", "waiting_for_approval", "failed"].includes(state.phase)
    )
      continue;
    const requestId = pending?.id ?? child?.pendingRuntimeRequest?.id;
    const identity = requestId ?? thread.latestRunId;
    if (!identity) continue;
    const source = child ?? thread;
    const latest = source.latestVisibleMessage;
    const eventAt = pending
      ? DateTime.toEpochMillis(pending.createdAt)
      : child?.pendingRuntimeRequest
        ? DateTime.toEpochMillis(child.pendingRuntimeRequest.createdAt)
        : completedAt;
    if (eventAt === null || eventAt < now - 3600_000) continue;
    result.push({
      key: JSON.stringify([environmentId, thread.id, identity, state.phase]),
      environmentId,
      threadId: thread.id,
      title: thread.title,
      body:
        latest?.role === "assistant" &&
        (!source.latestRunRequestedAt ||
          DateTime.toEpochMillis(latest.updatedAt) >=
            DateTime.toEpochMillis(source.latestRunRequestedAt))
          ? plainPreview(latest.text) || state.headline
          : state.headline,
      phase: state.phase,
      deepLink: state.deepLink,
      eventAt,
      ...(state.phase === "waiting_for_input" && requestId
        ? { question: { threadId: source.id, requestId } }
        : {}),
    });
  }
  return result;
}
