import { expect, it } from "vite-plus/test";
import { plainPreview } from "./notifications.ts";
import { apnsPayload } from "./apns.ts";
import { observeCandidates, type HubState } from "./store.ts";

it("preserves notification identity across reconnects and avoids historical alerts on first pairing", () => {
  const state: HubState = {
    devices: [{ id: "phone", token: "apns-token", credentialHash: "hash", preview: true }],
    seeded: {},
    observed: {},
    delivered: {},
    pending: [],
  };
  const candidate = {
    key: "env:thread:run:completed",
    environmentId: "env",
    threadId: "thread",
    title: "Voucher retailer number",
    body: "QA is ready",
    phase: "completed",
    eventAt: 100,
    deepLink: "/threads/env/thread",
  };
  observeCandidates(state, "env", [candidate], ["thread"], 100, true);
  expect(state.pending).toHaveLength(0);
  observeCandidates(state, "env", [], ["thread"], 200, false);
  const next = { ...candidate, key: "env:thread:next-run:completed" };
  observeCandidates(state, "env", [next], ["thread"], 300, false);
  expect(state.pending).toHaveLength(1);
  const restarted = JSON.parse(JSON.stringify(state)) as HubState;
  observeCandidates(restarted, "env", [next], ["thread"], 400, true);
  expect(restarted.pending).toHaveLength(1);
  observeCandidates(
    restarted,
    "env",
    [next, { ...next, threadId: "new-thread", key: "created-offline" }],
    ["thread", "new-thread"],
    401,
    true,
  );
  expect(restarted.pending).toHaveLength(2);
  restarted.pending = [];
  restarted.delivered[`phone:${next.key}`] = 400;
  observeCandidates(restarted, "env", [], ["thread"], 500, false);
  observeCandidates(restarted, "env", [next], ["thread"], 600, false);
  expect(restarted.pending).toHaveLength(0);
  expect(apnsPayload(next, true)).toMatchObject({
    aps: { alert: { title: candidate.title, body: candidate.body } },
    body: { environmentId: "env", threadId: "thread", deepLink: "/threads/env/thread" },
  });
  expect(apnsPayload(next, false).aps.alert.body).toBe("Done");
});

it("bounds previews and removes Markdown without breaking Unicode", () => {
  expect(
    plainPreview(
      "## Ready\n\n**Merged** [the change](https://example.com). ![secret screenshot](x)",
    ),
  ).toBe("Ready Merged the change.");
  expect(Array.from(plainPreview("😀".repeat(300)))).toHaveLength(180);
});

it("retries transient failures, removes expired tokens, and drops superseded alerts", async () => {
  const { prepareDelivery, finishDelivery } = await import("./delivery.ts");
  const deliverNext = async (
    value: HubState,
    now: number,
    send: (token: string) => Promise<{ status: number }>,
  ) => {
    const delivery = prepareDelivery(value, now);
    return delivery
      ? finishDelivery(value, delivery, now, await send(delivery.device.token))
      : null;
  };
  const candidate = {
    key: "done",
    environmentId: "env",
    threadId: "thread",
    title: "Task",
    body: "Finished",
    phase: "completed",
    eventAt: 100,
    deepLink: "/threads/env/thread",
  };
  const state: HubState = {
    devices: [{ id: "phone", token: "token", credentialHash: "hash", preview: true }],
    seeded: { env: true },
    observed: { "env:thread": "done" },
    delivered: {},
    pending: [{ deviceId: "phone", candidate, createdAt: 100, attempts: 0 }],
  };
  const sent: string[] = [];
  const temporary = async (token: string) => {
    sent.push(token);
    return { status: 503 };
  };
  await deliverNext(state, 1000, temporary);
  expect(sent).toEqual([]);
  expect(await deliverNext(state, 5100, temporary)).toContain("503");
  expect(state.pending[0]?.attempts).toBe(1);
  await deliverNext(state, 5200, temporary);
  expect(sent).toHaveLength(1);
  await deliverNext(state, 15_100, async () => ({ status: 200 }));
  expect(state.pending).toHaveLength(0);
  expect(state.delivered["phone:done"]).toBe(15_100);
  state.pending.push({ deviceId: "phone", candidate, createdAt: 100, attempts: 0 });
  state.observed["env:thread"] = null;
  await deliverNext(state, 20_000, temporary);
  expect(state.pending).toHaveLength(0);
  expect(sent).toHaveLength(1);
  state.observed["env:thread"] = "done";
  state.pending.push({ deviceId: "phone", candidate, createdAt: 100, attempts: 0 });
  expect(await deliverNext(state, 20_000, async () => ({ status: 410 }))).toContain("expired");
  expect(state.devices).toEqual([]);
  expect(state.pending).toEqual([]);
});

it("requires a valid unexpired invitation or the installation's existing credential", async () => {
  const { registerDevice, hashCredential } = await import("./api.ts");
  const state: HubState = { devices: [], seeded: {}, observed: {}, delivered: {}, pending: [] };
  const registration = {
    deviceId: "00000000-0000-0000-0000-000000000001",
    token: "a".repeat(64),
    preview: true,
  };
  const invitation = { hash: hashCredential("secret"), expiresAt: 100 };
  expect(() => registerDevice(state, registration, "wrong", invitation, 0)).toThrow("Unauthorized");
  expect(() => registerDevice(state, registration, "secret", invitation, 101)).toThrow(
    "Unauthorized",
  );
  expect(registerDevice(state, registration, "secret", invitation, 0)).toBe(true);
  expect(
    registerDevice(
      state,
      { ...registration, token: "b".repeat(64), preview: false },
      "secret",
      null,
      101,
    ),
  ).toBe(false);
  expect(state.devices).toMatchObject([{ token: "b".repeat(64), preview: false }]);
  expect(() =>
    registerDevice(
      state,
      { ...registration, deviceId: "00000000-0000-0000-0000-000000000002" },
      "secret",
      null,
      102,
    ),
  ).toThrow("Unauthorized");
});

it("observes done and user waits while ignoring snoozed, stopped, settled and child completions", async () => {
  const { makeRawThreadShell } = await import("../../src/test-fixtures.ts");
  const { EnvironmentId, ThreadId, RunId, MessageId, RuntimeRequestId } =
    await import("@t3tools/contracts");
  const DateTime = await import("effect/DateTime");
  const { notificationCandidates } = await import("./notifications.ts");
  const at = DateTime.makeUnsafe("2026-11-26T12:00:00Z");
  const now = DateTime.toEpochMillis(at);
  const thread = makeRawThreadShell({
    status: "completed",
    latestRunId: RunId.make("run"),
    latestRunCompletedAt: at,
    latestRunRequestedAt: at,
    latestVisibleMessage: {
      id: MessageId.make("message"),
      role: "assistant",
      text: "**Done** with QA",
      updatedAt: at,
    },
  });
  const environment = EnvironmentId.make("env");
  const candidates = (value: typeof thread) =>
    notificationCandidates(environment, new Map([[value.id, value]]), now);
  expect(candidates(thread)).toMatchObject([
    { title: "Thread", body: "Done with QA", phase: "completed" },
  ]);
  expect(candidates({ ...thread, latestRunStopRequested: true })).toEqual([]);
  expect(candidates({ ...thread, settledOverride: "settled" })).toEqual([]);
  expect(
    candidates({ ...thread, snoozedAt: at, snoozedUntil: DateTime.makeUnsafe(now + 60_000) }),
  ).toEqual([]);
  const waiting = {
    ...thread,
    status: "running" as const,
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make("ask"),
      kind: "user_input" as const,
      createdAt: at,
    },
  };
  expect(candidates(waiting)).toMatchObject([{ phase: "waiting_for_input" }]);
  const child = {
    ...waiting,
    id: ThreadId.make("child"),
    activityRunStatus: "running" as const,
    lineage: {
      rootThreadId: thread.id,
      parentThreadId: thread.id,
      relationshipToParent: "subagent" as const,
    },
    pendingRuntimeRequest: { ...waiting.pendingRuntimeRequest, userOnly: true },
  };
  expect(
    notificationCandidates(
      environment,
      new Map([
        [thread.id, thread],
        [child.id, child],
      ]),
      now,
    ),
  ).toMatchObject([{ threadId: thread.id, phase: "waiting_for_input" }]);
  expect(
    notificationCandidates(
      environment,
      new Map<string, typeof thread>([
        [thread.id, { ...thread, snoozedAt: at, snoozedUntil: DateTime.makeUnsafe(now + 60_000) }],
        [child.id, child],
      ]),
      now,
    ),
  ).toMatchObject([{ phase: "waiting_for_input" }]);
  expect(
    candidates({ ...thread, latestRunCompletedAt: DateTime.makeUnsafe(now - 3600_001) }),
  ).toEqual([]);
});
