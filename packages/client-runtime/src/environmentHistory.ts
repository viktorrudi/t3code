export const RESOURCE_HISTORY_WINDOW_MS = 60_000;
const MAX_SAMPLES = 64;
const MAX_SAMPLE_GAP_MS = 6_000;

export interface ResourceHistorySample {
  readonly observedAt: number;
  readonly cpuPercent: number | null;
  readonly memoryPercent: number | null;
}

export interface ResourceHistoryState {
  readonly samples: readonly ResourceHistorySample[];
  readonly sampledAt: number | null;
  readonly lastObservedAt: number | null;
}

export const EMPTY_RESOURCE_HISTORY: ResourceHistoryState = {
  samples: [],
  sampledAt: null,
  lastObservedAt: null,
};

function percentage(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function appendResourceHistory(
  state: ResourceHistoryState,
  input: ResourceHistorySample & { readonly sampledAt: number },
): ResourceHistoryState {
  if (
    !Number.isFinite(input.observedAt) ||
    !Number.isFinite(input.sampledAt) ||
    input.sampledAt < 0 ||
    (state.sampledAt !== null && input.sampledAt <= state.sampledAt)
  ) {
    return state;
  }
  const samples =
    state.lastObservedAt !== null && input.observedAt <= state.lastObservedAt
      ? []
      : state.samples.filter(
          (sample) => sample.observedAt >= input.observedAt - RESOURCE_HISTORY_WINDOW_MS,
        );
  return {
    sampledAt: input.sampledAt,
    lastObservedAt: input.observedAt,
    samples: [
      ...samples,
      {
        observedAt: input.observedAt,
        cpuPercent: percentage(input.cpuPercent),
        memoryPercent: percentage(input.memoryPercent),
      },
    ].slice(-MAX_SAMPLES),
  };
}

export function resourceHistorySegments(
  samples: readonly ResourceHistorySample[],
  metric: "cpuPercent" | "memoryPercent",
  now: number,
): readonly (readonly ResourceHistorySample[])[] {
  if (!Number.isFinite(now)) return [];
  const segments: ResourceHistorySample[][] = [];
  let current: ResourceHistorySample[] | undefined;
  for (const sample of samples) {
    if (
      sample.observedAt < now - RESOURCE_HISTORY_WINDOW_MS ||
      sample.observedAt > now ||
      percentage(sample[metric]) === null
    ) {
      current = undefined;
      continue;
    }
    const previous = current?.at(-1);
    if (
      current === undefined ||
      (previous !== undefined && sample.observedAt - previous.observedAt > MAX_SAMPLE_GAP_MS)
    ) {
      current = [];
      segments.push(current);
    }
    current.push(sample);
  }
  return segments;
}
