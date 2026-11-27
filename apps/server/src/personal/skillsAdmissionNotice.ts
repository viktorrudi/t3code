import type { OrchestrationV2TurnItem, RunId } from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

export function endSkillsAdmissionWait(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runId: RunId,
  status: "interrupted" | "failed",
  now: DateTime.Utc,
) {
  const waiting = items.find(
    (item): item is Extract<OrchestrationV2TurnItem, { type: "system_notice" }> =>
      item.runId === runId &&
      item.type === "system_notice" &&
      item.code === "skills_update_wait" &&
      item.status === "running",
  );
  if (waiting === undefined) return undefined;
  const message = status === "interrupted" ? "Interrupted" : "Failed";
  return {
    ...waiting,
    status,
    title: message,
    message,
    completedAt: now,
    updatedAt: now,
  } satisfies OrchestrationV2TurnItem;
}
