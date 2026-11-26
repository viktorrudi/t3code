import type { EnvironmentThreadShell } from "./models.ts";
import { hasUnseenRunFailure } from "./threadSettled.ts";

export type ThreadListV2Status =
  | "approval"
  | "input"
  | "request"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";
export function resolveThreadListV2Status(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "pendingGuestMessageCount"
    | "runtime"
    | "blockedOnThreadWait"
  >,
): ThreadListV2Status {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  // A guest is waiting on the owner; the agent's own requests come first.
  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return "request";
  }
  if (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) {
    return "waiting";
  }
  if (
    thread.runtime !== null &&
    ["preparing", "queued", "starting", "running", "waiting"].includes(thread.runtime.status)
  ) {
    return "working";
  }
  if (thread.runtime?.status === "idle") {
    return "waiting";
  }
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return "ready";
}

/** Row status: a failure the user has already opened settles to ready, like Done. */
export function resolveThreadListV2RowStatus(
  thread: Parameters<typeof resolveThreadListV2Status>[0] &
    Pick<EnvironmentThreadShell, "latestRun" | "lastVisitedAt">,
): ThreadListV2Status {
  const status = resolveThreadListV2Status(thread);
  // A runtime failure without a failed run has nothing to date it, so it stays.
  if (status !== "failed" || thread.latestRun?.status !== "failed") return status;
  return hasUnseenRunFailure(thread) ? status : "ready";
}
