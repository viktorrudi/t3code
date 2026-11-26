import type { HubState } from "./store.ts";
import type { PushCandidate } from "./notifications.ts";

export type SendPush = (
  token: string,
  candidate: PushCandidate,
  preview: boolean,
) => Promise<{ status: number; reason?: string }>;
export function prepareDelivery(state: HubState, now: number) {
  state.pending = state.pending.filter(
    (job) =>
      now - job.candidate.eventAt < 3600_000 &&
      state.devices.some((device) => device.id === job.deviceId) &&
      state.observed[`${job.candidate.environmentId}:${job.candidate.threadId}`] ===
        job.candidate.key,
  );
  const job = state.pending.find(
    (candidate) => now >= candidate.createdAt + Math.min(300_000, 5000 * 2 ** candidate.attempts),
  );
  const device = job && state.devices.find((candidate) => candidate.id === job.deviceId);
  return job && device ? { job, device } : null;
}
export function finishDelivery(
  state: HubState,
  delivery: NonNullable<ReturnType<typeof prepareDelivery>>,
  now: number,
  result: { status: number; reason?: string },
): string | null {
  const { job, device } = delivery;
  if (result.status === 200) {
    state.delivered[`${device.id}:${job.candidate.key}`] = now;
    state.pending = state.pending.filter((candidate) => candidate !== job);
    return null;
  }
  if (
    result.status === 410 ||
    result.reason === "BadDeviceToken" ||
    result.reason === "DeviceTokenNotForTopic"
  ) {
    state.devices = state.devices.filter(
      (candidate) => candidate.id !== device.id || candidate.token !== device.token,
    );
    state.pending = state.pending.filter(
      (candidate) =>
        candidate.deviceId !== device.id || state.devices.some((value) => value.id === device.id),
    );
    return "Device registration expired; reconnect notifications on the phone.";
  }
  job.attempts += 1;
  job.createdAt = now;
  if (
    job.attempts >= 8 ||
    (result.status >= 400 && result.status < 500 && result.status !== 429 && result.status !== 403)
  ) {
    state.pending = state.pending.filter((candidate) => candidate !== job);
  }
  return `Apple push delivery failed (${result.status}, ${result.reason ?? "Unknown"}).`;
}
