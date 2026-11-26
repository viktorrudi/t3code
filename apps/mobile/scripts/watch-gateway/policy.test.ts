import { describe, expect, it } from "vite-plus/test";
import { authorize, credentialHash, page, requireProject, type WatchGrant } from "./policy.ts";
import { commandRunner, type CommandJournal } from "./commands.ts";

describe("Watch gateway authority and retry boundary", () => {
  const grant: WatchGrant = {
    id: "watch",
    credentialHash: credentialHash("dedicated-watch-token"),
    expiresAt: 200,
    operate: false,
    projects: { mac: ["allowed"] },
  };
  it("rejects expired and wrong credentials and isolates projects and write access", () => {
    expect(authorize([grant], "dedicated-watch-token", 100)).toBe(grant);
    expect(() => authorize([grant], "other-device", 100)).toThrow();
    expect(() => authorize([grant], "dedicated-watch-token", 200)).toThrow();
    expect(() => requireProject(grant, "mac", "allowed")).not.toThrow();
    expect(() => requireProject(grant, "other-mac", "allowed")).toThrow();
    expect(() => requireProject(grant, "mac", "other")).toThrow();
    expect(() => requireProject(grant, "mac", "allowed", true)).toThrow();
  });
  it("rejects a cursor after a list revision or scope changes", () => {
    const first = page([1, 2, 3], null, "scope-a", 1);
    expect(page([1, 2, 3], first.nextCursor, "scope-a", 1).items).toEqual([2]);
    expect(() => page([1, 2, 3], first.nextCursor, "scope-b", 1)).toThrow("List changed");
    expect(() => page([1], "bad", "scope-a")).toThrow();
  });
  it("coalesces concurrent retries and replays a persisted receipt after restart", async () => {
    const journal: CommandJournal = {};
    let executions = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = commandRunner(
      journal,
      async () => {},
      async () => {},
    );
    const execute = async () => {
      executions++;
      await ready;
      return { threadId: "same-thread" };
    };
    const first = run("watch:id", "draft-a", execute);
    const retry = run("watch:id", "draft-a", execute);
    release();
    expect(await first).toEqual(await retry);
    expect(executions).toBe(1);
    const restarted = commandRunner(
      JSON.parse(JSON.stringify(journal)),
      async () => {},
      async () => {},
    );
    expect(await restarted("watch:id", "draft-a", execute)).toEqual({ threadId: "same-thread" });
    expect(executions).toBe(1);
    await expect(run("watch:id", "different-draft", execute)).rejects.toThrow("different draft");
  });
  it("persists command identity before dispatch and safely retries uncertain delivery", async () => {
    const journal: CommandJournal = {};
    let committed = false;
    const failedStorage = commandRunner(
      journal,
      async () => {
        throw new Error("disk full");
      },
      async () => {},
    );
    await expect(
      failedStorage("watch:id", "draft", async () => {
        committed = true;
        return {};
      }),
    ).rejects.toThrow("disk full");
    expect(committed).toBe(false);
    const run = commandRunner(
      journal,
      async () => {},
      async () => {},
    );
    await expect(
      run("watch:id", "draft", async () => {
        throw new Error("connection lost after commit");
      }),
    ).rejects.toThrow();
    expect(journal["watch:id"]?.fingerprint).toBe("draft");
    expect(await run("watch:id", "draft", async () => ({ accepted: true }))).toEqual({
      accepted: true,
    });
  });
});
