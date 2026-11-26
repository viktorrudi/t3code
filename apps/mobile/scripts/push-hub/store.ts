import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import type { PushCandidate } from "./notifications.ts";

export interface HubDevice {
  readonly id: string;
  readonly credentialHash: string;
  readonly token: string;
  readonly preview: boolean;
}
export interface HubState {
  devices: HubDevice[];
  observed: Record<string, string | null>;
  seeded: Record<string, boolean>;
  delivered: Record<string, number>;
  pending: Array<{
    readonly deviceId: string;
    readonly candidate: PushCandidate;
    createdAt: number;
    attempts: number;
  }>;
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await NodeFSP.rename(temporary, path);
}

export async function readHubState(path: string): Promise<HubState> {
  try {
    // The state is written only by this process, never accepted over HTTP.
    const state = JSON.parse(await NodeFSP.readFile(path, "utf8")) as HubState;
    if (
      !Array.isArray(state.devices) ||
      !Array.isArray(state.pending) ||
      !state.observed ||
      !state.delivered
    )
      throw new Error("Invalid notification hub state");
    state.seeded ??= Object.fromEntries(
      Object.keys(state.observed).map((key) => [key.split(":")[0], true]),
    );
    return state;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return { devices: [], seeded: {}, observed: {}, delivered: {}, pending: [] };
    throw error;
  }
}

export function observeCandidates(
  state: HubState,
  environmentId: string,
  candidates: ReadonlyArray<PushCandidate>,
  threadIds: ReadonlyArray<string>,
  now: number,
  initial: boolean,
): boolean {
  const firstSync = initial && !state.seeded[environmentId];
  let changed = !state.seeded[environmentId];
  state.seeded[environmentId] = true;
  const byThread = new Map(candidates.map((candidate) => [candidate.threadId, candidate]));
  const liveIds = new Set(threadIds.map((id) => `${environmentId}:${id}`));
  for (const id of Object.keys(state.observed)) {
    if (id.startsWith(`${environmentId}:`) && !liveIds.has(id)) {
      delete state.observed[id];
      changed = true;
    }
  }
  for (const threadId of threadIds) {
    const id = `${environmentId}:${threadId}`;
    const candidate = byThread.get(threadId);
    const key = candidate?.key ?? null;
    const previous = state.observed[id];
    if (previous !== key) changed = true;
    state.observed[id] = key;
    if (!candidate || previous === key || firstSync) continue;
    for (const device of state.devices) {
      const deliveryKey = `${device.id}:${key}`;
      if (
        state.delivered[deliveryKey] !== undefined ||
        state.pending.some((job) => job.deviceId === device.id && job.candidate.key === key)
      )
        continue;
      state.pending.push({ deviceId: device.id, candidate, createdAt: now, attempts: 0 });
    }
  }
  const deliveredCount = Object.keys(state.delivered).length;
  state.delivered = Object.fromEntries(
    Object.entries(state.delivered).filter(([, at]) => now - at < 7 * 86400_000),
  );
  return changed || deliveredCount !== Object.keys(state.delivered).length;
}
