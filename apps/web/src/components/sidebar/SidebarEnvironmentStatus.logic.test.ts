import type { HostResourcesSnapshot } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { sidebarBattery, sidebarHostMetrics } from "./SidebarEnvironmentStatus.logic";

it("uses receipt time for freshness across machines and marks retained failed data stale", () => {
  const snapshot: HostResourcesSnapshot = {
    sampledAt: 900_000,
    cpuUtilization: 0,
    cpuCount: 8,
    totalMemoryBytes: 1_000,
    availableMemoryBytes: 250,
  };
  const input = { snapshot, receivedAt: 1_000, now: 11_000, failed: false };
  expect(sidebarHostMetrics(input)).toMatchObject({
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

it("distinguishes zero work and disk from unavailable legacy fields", () => {
  const legacy: HostResourcesSnapshot = {
    sampledAt: 0,
    cpuUtilization: null,
    cpuCount: 0,
    totalMemoryBytes: 1,
    availableMemoryBytes: 1,
  };
  const input = { snapshot: legacy, receivedAt: 0, now: 0, failed: false };
  expect(sidebarHostMetrics(input)).toMatchObject({
    workingAgentCount: null,
    diskAvailableBytes: null,
  });
  expect(
    sidebarHostMetrics({
      ...input,
      snapshot: {
        ...legacy,
        workingAgentCount: 0,
        disk: { scope: "t3-data-filesystem", availableBytes: 0 },
      },
    }),
  ).toMatchObject({ workingAgentCount: 0, diskAvailableBytes: 0 });
});

it("shows battery only for a known laptop below full charge", () => {
  const snapshot: HostResourcesSnapshot = {
    sampledAt: 0,
    cpuUtilization: null,
    cpuCount: 0,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    battery: { percent: 87, charging: true },
  };
  expect(sidebarBattery(snapshot, "laptop")).toEqual({ percent: 87, charging: true });
  expect(sidebarBattery(snapshot, "desktop")).toBeNull();
  expect(sidebarBattery(snapshot, undefined)).toBeNull();
  expect(sidebarBattery({ ...snapshot, battery: null }, "laptop")).toBeNull();
  expect(
    sidebarBattery({ ...snapshot, battery: { percent: 100, charging: false } }, "laptop"),
  ).toBeNull();
  expect(
    sidebarBattery({ ...snapshot, battery: { percent: 0, charging: null } }, "laptop"),
  ).toEqual({ percent: 0, charging: null });
});
