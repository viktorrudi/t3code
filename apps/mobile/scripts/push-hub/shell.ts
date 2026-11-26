import type {
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";

export function updateNotificationThreads(
  threads: Map<string, OrchestrationV2ThreadShell>,
  item: OrchestrationV2ShellStreamItem,
): boolean {
  if (item.kind === "snapshot") {
    if (item.resolvedRepositoryIdentityRoots !== undefined) return false;
    threads.clear();
    for (const thread of item.snapshot.threads) threads.set(thread.id, thread);
  } else if (item.kind === "thread.updated") {
    if (item.location === "active") threads.set(item.thread.id, item.thread);
    else threads.delete(item.thread.id);
  } else if (item.kind === "thread.removed") threads.delete(item.threadId);
  else return false;
  return true;
}
