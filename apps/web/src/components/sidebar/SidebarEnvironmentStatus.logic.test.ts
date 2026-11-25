import type { HostResourcesSnapshot } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { sidebarHostMetrics } from "./SidebarEnvironmentStatus.logic";

it("uses receipt time for freshness across machines and marks retained failed data stale", () => {
  const snapshot: HostResourcesSnapshot = {
    sampledAt: 900_000,
    cpuUtilization: 0,
    cpuCount: 8,
    totalMemoryBytes: 1_000,
    availableMemoryBytes: 250,
  };
  const input = { snapshot, receivedAt: 1_000, now: 11_000, failed: false };
  expect(sidebarHostMetrics(input)).toEqual({
    ageSeconds: 10,
    stale: false,
    cpuPercent: 0,
    memoryUsedBytes: 750,
    memoryPercent: 75,
  });
  expect(sidebarHostMetrics({ ...input, now: 31_000 }).stale).toBe(true);
  expect(sidebarHostMetrics({ ...input, failed: true }).stale).toBe(true);
  expect(sidebarHostMetrics({ ...input, now: 0 }).ageSeconds).toBe(0);
});

it("preserves unavailable metrics rather than inventing zero percentages", () => {
  const missing = { snapshot: null, receivedAt: 0, now: 10_000, failed: true };
  expect(sidebarHostMetrics(missing)).toMatchObject({
    stale: false,
    cpuPercent: null,
    memoryPercent: null,
  });
  for (const [cpuUtilization, totalMemoryBytes, availableMemoryBytes] of [
    [null, 0, 0],
    [Number.NaN, 100, 101],
    [2, 100, -1],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0],
  ] as const) {
    expect(
      sidebarHostMetrics({
        ...missing,
        snapshot: {
          sampledAt: 0,
          cpuCount: 0,
          cpuUtilization,
          totalMemoryBytes,
          availableMemoryBytes,
        },
      }),
    ).toMatchObject({ cpuPercent: null, memoryUsedBytes: null, memoryPercent: null });
  }
});
