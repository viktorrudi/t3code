import { describe, expect, it } from "vite-plus/test";

import {
  appendResourceHistory,
  EMPTY_RESOURCE_HISTORY,
  resourceHistorySegments,
} from "./SidebarEnvironmentHistory.logic";

const reading = (
  time: number,
  cpuPercent: number | null = 0,
  memoryPercent: number | null = 50,
) => ({
  sampledAt: time,
  observedAt: time,
  cpuPercent,
  memoryPercent,
});

describe("environment resource history", () => {
  it("retains real zero, rejects cached and out-of-order samples, and sanitizes each metric", () => {
    const first = appendResourceHistory(EMPTY_RESOURCE_HISTORY, reading(10_000));
    expect(first.samples[0]?.cpuPercent).toBe(0);
    expect(appendResourceHistory(first, { ...reading(10_000), observedAt: 12_000 })).toBe(first);
    expect(appendResourceHistory(first, reading(9_000))).toBe(first);
    expect(appendResourceHistory(first, reading(Number.NaN))).toBe(first);
    const second = appendResourceHistory(first, reading(12_000, Number.NaN, 101));
    expect(second.samples.at(-1)).toEqual({
      observedAt: 12_000,
      cpuPercent: null,
      memoryPercent: null,
    });
  });

  it("bounds both the rolling time window and burst storage, and resets on local clock regression", () => {
    let state = EMPTY_RESOURCE_HISTORY;
    for (let time = 0; time <= 80_000; time += 2_000) {
      state = appendResourceHistory(state, reading(time));
    }
    expect(state.samples).toHaveLength(31);
    expect(state.samples[0]?.observedAt).toBe(20_000);
    for (let time = 80_001; time <= 80_100; time += 1) {
      state = appendResourceHistory(state, reading(time));
    }
    expect(state.samples).toHaveLength(64);
    state = appendResourceHistory(state, { ...reading(81_000), observedAt: 40_000 });
    expect(state.samples).toEqual([{ observedAt: 40_000, cpuPercent: 0, memoryPercent: 50 }]);
  });

  it("splits each metric at unavailable observations and poll gaps without fabricating history", () => {
    const samples = [
      reading(2_000),
      reading(4_000, null),
      reading(6_000),
      reading(14_000),
      reading(16_000),
    ];
    expect(
      resourceHistorySegments(samples, "cpuPercent", 16_000).map((part) =>
        part.map((s) => s.observedAt),
      ),
    ).toEqual([[2_000], [6_000], [14_000, 16_000]]);
    expect(
      resourceHistorySegments(samples, "memoryPercent", 16_000).map((part) => part.length),
    ).toEqual([3, 2]);
    expect(resourceHistorySegments(samples, "cpuPercent", 76_001)).toEqual([]);
    expect(
      resourceHistorySegments(samples, "cpuPercent", 3_000)
        .flat()
        .map((s) => s.observedAt),
    ).toEqual([2_000]);
  });
});
