import type { HostResourcesSnapshot } from "@t3tools/contracts";

export const HOST_STATUS_REFRESH_MS = 10_000;
export const HOST_STATUS_STALE_MS = 30_000;

export function sidebarHostMetrics(input: {
  readonly snapshot: HostResourcesSnapshot | null;
  readonly receivedAt: number;
  readonly now: number;
  readonly failed: boolean;
}) {
  const { snapshot, receivedAt, now, failed } = input;
  const ageSeconds = Math.max(0, Math.floor((now - receivedAt) / 1_000));
  const stale = snapshot !== null && (failed || now - receivedAt >= HOST_STATUS_STALE_MS);
  const cpu = snapshot?.cpuUtilization;
  const cpuPercent =
    cpu !== null && cpu !== undefined && Number.isFinite(cpu) && cpu >= 0 && cpu <= 1
      ? Math.round(cpu * 100)
      : null;
  const total = snapshot?.totalMemoryBytes ?? 0;
  const available = snapshot?.availableMemoryBytes ?? -1;
  const memoryUsedBytes =
    Number.isFinite(total) &&
    Number.isFinite(available) &&
    total > 0 &&
    available >= 0 &&
    available <= total
      ? total - available
      : null;
  return {
    ageSeconds,
    stale,
    cpuPercent,
    memoryUsedBytes,
    memoryPercent: memoryUsedBytes === null ? null : Math.round((memoryUsedBytes / total) * 100),
  };
}
