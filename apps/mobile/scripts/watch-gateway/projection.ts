import {
  EnvironmentId,
  isListedThreadLineage,
  type OrchestrationV2ThreadShell,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/subagent-requests";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveThreadListV2RowStatus } from "@t3tools/client-runtime/state/thread-list-status";
import { canSnooze, effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortActiveThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import { credentialHash, type WatchGrant } from "./policy.ts";

export function projectRows(
  environmentId: string,
  environment: string,
  projects: readonly OrchestrationProjectShell[],
  threads: readonly OrchestrationV2ThreadShell[],
  live: boolean,
  asOf: string,
  grant: WatchGrant,
) {
  const now = live ? new Date().toISOString() : asOf;
  const pending = pendingSubagentRequestsByThread(threads);
  const scoped = threads.map((t) => {
    const request = pending.get(t.id);
    return presentThreadShell(
      EnvironmentId.make(environmentId),
      t,
      request === "user_only_input" ? "user_input" : (request ?? null),
    );
  });
  const priority = {
    approval: 0,
    input: 1,
    request: 2,
    failed: 3,
    limited: 4,
    working: 5,
    waiting: 6,
    ready: 7,
  };
  return sortActiveThreadsByOrderKey(scoped)
    .filter(
      (t) =>
        !t.deletedAt &&
        !t.archivedAt &&
        isListedThreadLineage(t.lineage) &&
        grant.projects[environmentId]?.includes(t.projectId),
    )
    .map((t) => {
      const project = projects.find((p) => p.id === t.projectId);
      const status = resolveThreadListV2RowStatus(t);
      const snoozed = effectiveSnoozed(t, { now });
      return {
        id: `${environmentId}:${t.id}`,
        environmentId,
        threadId: t.id,
        environment,
        projectId: t.projectId,
        project: project?.title ?? "Project",
        title: t.title,
        status,
        phase: t.runtime?.status ?? "ready",
        model: String(t.modelSelection.model),
        shelf: snoozed ? "snoozed" : t.settledOverride === "settled" ? "settled" : "active",
        wake: t.snoozedUntil,
        asOf,
        live,
        canWrite: grant.operate && live,
        canSnooze: grant.operate && live && canSnooze(t, { now }),
        priority: priority[status],
      };
    })
    .sort((a, b) => a.priority - b.priority);
}
export function revision(value: unknown) {
  return credentialHash(JSON.stringify(value)).slice(0, 24);
}
