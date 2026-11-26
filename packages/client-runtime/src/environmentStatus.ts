import type { EnvironmentMachineKind, HostResourcesSnapshot } from "@t3tools/contracts";

export const HOST_STATUS_REFRESH_MS = 2_000;
export const HOST_STATUS_STALE_MS = 30_000;

export function sidebarHostMetrics(input: {
  readonly snapshot: HostResourcesSnapshot | null;
  readonly receivedAt: number;
  readonly now: number;
  readonly failed: boolean;
  readonly staleAfterMs?: number;
}) {
  const { snapshot, receivedAt, now, failed } = input;
  const ageSeconds = Math.max(0, Math.floor((now - receivedAt) / 1_000));
  const stale =
    snapshot !== null &&
    (failed || now - receivedAt >= (input.staleAfterMs ?? HOST_STATUS_STALE_MS));
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
  const count = snapshot?.workingAgentCount;
  const disk = snapshot?.disk;
  const workingAgentCount =
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
  const diskAvailableBytes =
    disk?.scope === "t3-data-filesystem" &&
    Number.isSafeInteger(disk.availableBytes) &&
    disk.availableBytes >= 0
      ? disk.availableBytes
      : null;
  const detailsAvailability =
    workingAgentCount !== null || diskAvailableBytes !== null
      ? null
      : snapshot !== null && !failed && count === undefined && disk === undefined
        ? "legacy"
        : "unavailable";
  return {
    workingAgentCount,
    diskAvailableBytes,
    detailsAvailability,
    ageSeconds,
    stale,
    cpuPercent,
    memoryUsedBytes,
    memoryPercent: memoryUsedBytes === null ? null : Math.round((memoryUsedBytes / total) * 100),
  };
}

export function sidebarBattery(
  snapshot: HostResourcesSnapshot | null,
  machine: EnvironmentMachineKind | undefined,
) {
  const battery = snapshot?.battery;
  return machine === "laptop" &&
    battery != null &&
    Number.isFinite(battery.percent) &&
    battery.percent >= 0 &&
    battery.percent < 100
    ? { percent: Math.floor(battery.percent), charging: battery.charging }
    : null;
}

export function orderSidebarEnvironments<
  T extends { readonly environmentId: string; readonly connection: { readonly phase: string } },
>(environments: ReadonlyArray<T>, currentEnvironmentId: string | null): T[] {
  const rank = (environment: T) =>
    environment.environmentId === currentEnvironmentId
      ? 0
      : environment.connection.phase === "connected"
        ? 1
        : 2;
  return [...environments].sort((a, b) => rank(a) - rank(b));
}
