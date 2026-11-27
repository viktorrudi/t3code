import * as DateTime from "effect/DateTime";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadHistoryPage,
  DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
  EnvironmentSpeechStatus,
  type OrchestrationV2ThreadShell,
  type ServerConfig,
  type OrchestrationProjectShell,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { effectiveSpeechLanguage, encodeSpeechPcmRequest } from "@t3tools/shared/speech";
import { watchEnvironment, pairEnvironment, type HubConnection } from "../push-hub/environment.ts";
import { updateNotificationThreads } from "../push-hub/shell.ts";
import { writePrivateJson } from "../push-hub/store.ts";
import { watchPush } from "./push.ts";
import { commandRunner } from "./commands.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { projectRows, revision } from "./projection.ts";
import {
  authorize,
  credentialHash,
  commandIdentity,
  page,
  requireProject,
  WatchError,
  type WatchGrant,
} from "./policy.ts";

const Config = Schema.Struct({
  directory: Schema.String,
  publicOrigin: Schema.String,
  port: Schema.Number,
  apns: Schema.optional(
    Schema.Struct({
      keyPath: Schema.String,
      keyId: Schema.String,
      teamId: Schema.String,
      bundleId: Schema.String,
    }),
  ),
  environments: Schema.Array(
    Schema.Struct({
      environmentId: Schema.String,
      name: Schema.String,
      origin: Schema.String,
      credentialPath: Schema.String,
    }),
  ),
});
type Config = typeof Config.Type;
type Environment = {
  config: Config["environments"][number];
  threads: Map<string, OrchestrationV2ThreadShell>;
  projects: readonly OrchestrationProjectShell[];
  connection?: HubConnection;
  server?: ServerConfig;
  asOf: string;
};
const runFile = NodeUtil.promisify(NodeChildProcess.execFile);
const bodySchema = Schema.Struct({
  commandId: Schema.String,
  text: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Literals(["snooze", "wake", "settle", "reopen", "undo"])),
  minutes: Schema.optional(Schema.Number),
  undoCommandId: Schema.optional(Schema.String),
  expectedLatestRunId: Schema.optional(Schema.String),
  restoreUnsettledAt: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeBody = Schema.decodeUnknownSync(bodySchema);
const decodeUndoReceipt = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: Schema.String,
    threadId: Schema.String,
    undoAction: Schema.Literals(["wake", "reopen", "snooze", "settle"]),
    undoUntil: Schema.Number,
    restoreUnsettledAt: Schema.NullOr(Schema.String),
    restoreSnoozedUntil: Schema.NullOr(Schema.String),
  }),
);
const decodeSpeechStatus = Schema.decodeUnknownSync(EnvironmentSpeechStatus);
function messages(items: readonly OrchestrationV2ProjectedTurnItem[]) {
  return items.flatMap(({ item, position }) => {
    if (item.type === "user_message" || item.type === "assistant_message")
      return [
        {
          id: item.id,
          position,
          role: item.type === "user_message" ? "You" : "Agent",
          text: item.text,
        },
      ];
    if (item.type === "user_input_request")
      return [
        {
          id: item.id,
          position,
          role: "Needs input",
          text: item.questions.map((q) => q.question).join("\n\n"),
        },
      ];
    if (item.type === "approval_request")
      return [
        {
          id: item.id,
          position,
          role: "Needs approval on iPhone or Mac",
          text: [item.prompt, item.reason].filter(Boolean).join("\n") || item.requestKind,
        },
      ];
    return [];
  });
}
const decodeWatchBoundary0 = Schema.decodeUnknownSync(Config);
const decodeWatchBoundary1 = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);
const decodeWatchBoundary2 = Schema.decodeUnknownSync(
  Schema.Struct({
    token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64,200}$/)),
    preview: Schema.Boolean,
  }),
);
const decodeWatchBoundary3 = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, projectId: Schema.String }),
);
const decodeWatchBoundary4 = Schema.decodeUnknownSync(OrchestrationV2ThreadHistoryPage);
const decodeWatchBoundary5 = Schema.decodeUnknownSync(OrchestrationV2ThreadBoundedSnapshot);
const decodeWatchBoundary6 = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

async function main() {
  const [command, configPath, ...args] = process.argv.slice(2);
  if (!configPath || !["run", "pair", "invite", "revoke"].includes(command ?? ""))
    throw new Error(
      "Usage: watch-gateway run|pair|invite|revoke /absolute/config.json [arguments]",
    );
  const config = decodeWatchBoundary0(JSON.parse(await NodeFSP.readFile(configPath, "utf8")));
  if (
    !NodePath.isAbsolute(config.directory) ||
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error("Invalid gateway storage or port");
  if (
    config.apns &&
    (!NodePath.isAbsolute(config.apns.keyPath) || !config.apns.bundleId.endsWith(".watchkitapp"))
  )
    throw new Error("Configure a dedicated Watch APNs topic and absolute key path");
  const publicOrigin = new URL(config.publicOrigin);
  if (
    publicOrigin.protocol !== "https:" ||
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search ||
    publicOrigin.hash
  )
    throw new Error("A dedicated HTTPS origin is required");
  for (const e of config.environments) {
    const u = new URL(e.origin);
    if (
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !NodePath.isAbsolute(e.credentialPath)
    )
      throw new Error("Invalid environment configuration");
  }
  await NodeFSP.mkdir(config.directory, { recursive: true, mode: 0o700 });
  const grantsPath = NodePath.join(config.directory, "watch-grants.json");
  const readGrants = async (): Promise<WatchGrant[]> =>
    JSON.parse(
      await NodeFSP.readFile(grantsPath, "utf8").catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return "[]";
        throw e;
      }),
    );
  if (command === "pair") {
    const e = config.environments.find((e) => e.environmentId === args[0]);
    if (!e || !args[1])
      throw new Error("pair requires environment-id and private bootstrap-token file");
    await pairEnvironment(e, (await NodeFSP.readFile(args[1], "utf8")).trim(), [
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    console.log(
      "Dedicated Watch gateway session paired. Keep its credential separate from the notification hub.",
    );
    return;
  }
  if (command === "invite") {
    if (!args[0])
      throw new Error(
        "invite requires an absolute project-allowlist JSON file; optional read-only",
      );
    const projects = decodeWatchBoundary1(JSON.parse(await NodeFSP.readFile(args[0], "utf8")));
    if (
      Object.keys(projects).some((id) => !config.environments.some((e) => e.environmentId === id))
    )
      throw new Error("Unknown environment in project allowlist");
    const pushToken = NodeCrypto.randomBytes(32).toString("base64url");
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    const id = NodeCrypto.randomBytes(12).toString("hex");
    const grants = await readGrants();
    grants.push({
      id,
      projects,
      pushCredentialHash: credentialHash(pushToken),
      credentialHash: credentialHash(token),
      operate: args[1] !== "read-only",
      expiresAt: Date.now() + 30 * 86400_000,
    });
    await writePrivateJson(grantsPath, grants);
    const invitation = NodePath.join(config.directory, `watch-setup-${id}.json`);
    await writePrivateJson(invitation, { url: config.publicOrigin, token, pushToken });
    console.log(
      `Watch setup saved privately to ${invitation}. Transfer to Watch, then remove this file. Expires in 30 days; revoke by ID ${id}.`,
    );
    return;
  }
  if (command === "revoke") {
    await writePrivateJson(
      grantsPath,
      (await readGrants()).filter((g) => g.id !== args[0]),
    );
    console.log("Watch credential revoked.");
    return;
  }
  const shutdown = new AbortController();
  process.once("SIGTERM", () => shutdown.abort());
  process.once("SIGINT", () => shutdown.abort());
  const environments: Environment[] = config.environments.map((e) => ({
    config: e,
    threads: new Map(),
    projects: [],
    asOf: new Date(0).toISOString(),
  }));
  const push = await watchPush(
    config.directory,
    config.apns,
    readGrants,
    (environmentId, threadId) =>
      environments.find((e) => e.config.environmentId === environmentId)?.threads.get(threadId)
        ?.projectId,
  );
  const watchers = environments.map(async (e) => {
    while (!shutdown.signal.aborted) {
      let first = true;
      try {
        await watchEnvironment(
          e.config,
          async (item) => {
            if (item.kind === "snapshot" && item.resolvedRepositoryIdentityRoots === undefined)
              e.projects = item.snapshot.projects;
            if (item.kind === "project.updated")
              e.projects = [...e.projects.filter((p) => p.id !== item.project.id), item.project];
            else if (item.kind === "project.removed")
              e.projects = e.projects.filter((p) => p.id !== item.projectId);
            if (updateNotificationThreads(e.threads, item)) {
              e.asOf = new Date().toISOString();
              await push.observe(e.config.environmentId, e.threads, first);
              first = false;
            }
          },
          shutdown.signal,
          (connection) => {
            e.connection = connection;
            void connection
              .config()
              .then((config) => {
                e.server = config;
              })
              .catch(() => {
                e.server = undefined;
              });
          },
        );
      } catch {
        /* Disconnected environments remain readable with explicit freshness. */
      }
      e.connection = undefined;
      if (!shutdown.signal.aborted)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            shutdown.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 10_000);
          shutdown.signal.addEventListener("abort", done, { once: true });
        });
    }
  });
  const rates = new Map<string, { at: number; count: number }>();
  const journalPath = NodePath.join(config.directory, "commands.json");
  const journal: Record<string, { fingerprint: string; result?: unknown }> = JSON.parse(
    await NodeFSP.readFile(journalPath, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "{}";
      throw e;
    }),
  );
  let serial = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(journal);
    const next = serial.then(() => writePrivateJson(journalPath, JSON.parse(snapshot)));
    serial = next.catch(() => {});
    return next;
  };
  const once = commandRunner(journal, save, async (key) => {
    await NodeFSP.appendFile(
      NodePath.join(config.directory, "audit.jsonl"),
      JSON.stringify({
        device: key.split(":")[0],
        command: key.split(":")[1],
        at: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600 },
    );
  });

  const server = NodeHttp.createServer((req, res) => {
    const cancelled = new AbortController();
    req.once("aborted", () => cancelled.abort());
    res.once("close", () => {
      if (!res.writableEnded) cancelled.abort();
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    void (async () => {
      if (req.headers.origin) throw new WatchError(403, "Browser requests are not supported.");
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new WatchError(401, "Pair your Watch again.");
      if (req.method === "DELETE" && req.url === "/watch/v1/devices") return push.unregister(token);
      if (req.method === "POST" && req.url === "/watch/v1/devices") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk.toString();
          if (Buffer.byteLength(raw) > 1024)
            throw new WatchError(413, "Registration is too large.");
        }
        const device = decodeWatchBoundary2(JSON.parse(raw));
        return push.register(token, device.token, device.preview);
      }
      const grant = authorize(await readGrants(), token, Date.now());
      const rate = rates.get(grant.id);
      const now = Date.now();
      if (rate && rate.at + 60_000 > now && ++rate.count > 90)
        throw new WatchError(429, "Too many requests. Try again shortly.");
      if (!rate || rate.at + 60_000 <= now) rates.set(grant.id, { at: now, count: 1 });
      const url = new URL(req.url ?? "/", "http://localhost");
      const rows = environments.flatMap((e) =>
        projectRows(
          e.config.environmentId,
          e.config.name,
          e.projects,
          [...e.threads.values()],
          !!e.connection,
          e.asOf,
          grant,
        ),
      );
      if (req.method === "GET" && url.pathname === "/watch/v1/overview") {
        const scope = url.searchParams.get("scope");
        const scoped = rows.filter((r) => !scope || `${r.environmentId}:${r.projectId}` === scope);
        const shelf = url.searchParams.get("shelf") ?? "active";
        const projects = environments.flatMap((e) =>
          e.projects
            .filter((p) => !p.archivedAt && grant.projects[e.config.environmentId]?.includes(p.id))
            .map((p) => ({
              id: `${e.config.environmentId}:${p.id}`,
              environmentId: e.config.environmentId,
              projectId: p.id,
              title: p.title,
              environment: e.config.name,
              model: p.defaultModelSelection
                ? String(p.defaultModelSelection.model)
                : "Choose defaults on iPhone",
              canCreate:
                grant.operate &&
                !!e.connection &&
                !!p.defaultModelSelection &&
                (p.defaultThreadEnvMode ?? e.server?.settings.defaultThreadEnvMode) === "local",
            })),
        );
        return {
          ...page(
            scoped.filter((r) => r.shelf === shelf),
            url.searchParams.get("cursor"),
            revision([grant.id, scope, shelf, scoped.map((r) => [r.id, r.status, r.shelf])]),
          ),
          projects,
          counts: {
            snoozed: scoped.filter((r) => r.shelf === "snoozed").length,
            settled: scoped.filter((r) => r.shelf === "settled").length,
          },
          environments: environments
            .filter((e) => grant.projects[e.config.environmentId])
            .map((e) => ({ name: e.config.name, live: !!e.connection, asOf: e.asOf })),
        };
      }
      const match = /^\/watch\/v1\/threads\/([^/]+)\/([^/]+)(?:\/(messages|shelf|voice))?$/.exec(
        url.pathname,
      );
      const newChat = url.pathname === "/watch/v1/threads";
      const newVoice = url.pathname === "/watch/v1/voice/transcriptions";
      let raw = Buffer.alloc(0);
      const maximum = match?.[3] === "voice" || newVoice ? 1_500_000 : 32768;
      for await (const chunk of req) {
        raw = Buffer.concat([raw, Buffer.from(chunk)]);
        if (raw.length > maximum) throw new WatchError(413, "Request is too large.");
      }
      const newDestination = newVoice
        ? {
            environmentId: url.searchParams.get("environmentId") ?? "",
            projectId: url.searchParams.get("projectId") ?? "",
          }
        : newChat
          ? decodeWatchBoundary3(JSON.parse(raw.toString()))
          : undefined;
      const environmentId = match ? decodeURIComponent(match[1]!) : newDestination?.environmentId;
      const e = environments.find((e) => e.config.environmentId === environmentId);
      if (!e) throw new WatchError(404, "Environment not found.");
      const threadId = match && decodeURIComponent(match[2]!);
      const thread = threadId ? e.threads.get(threadId) : undefined;
      const projectId = thread?.projectId ?? newDestination?.projectId;
      if (!projectId)
        throw new WatchError(404, "Chat is missing. No replacement chat was created.");
      requireProject(grant, e.config.environmentId, projectId, req.method !== "GET");
      if (!e.connection)
        throw new WatchError(503, `${e.config.name} is offline. Your draft is kept.`);
      const connection = e.connection;
      if (req.method === "GET" && thread && !match?.[3]) {
        const cursor = url.searchParams.get("before");
        const row = rows.find(
          (r) => r.environmentId === e.config.environmentId && r.threadId === threadId,
        );
        if (!row) throw new WatchError(404, "Chat is no longer available.");
        if (cursor) {
          const value = decodeWatchBoundary4(
            await connection.request(
              `/api/orchestration/threads/${encodeURIComponent(thread.id)}/history?view=conversation&cursor=${encodeURIComponent(cursor)}`,
            ),
          );
          return { row, messages: messages(value.items), nextCursor: value.nextCursor };
        }
        const value = decodeWatchBoundary5(
          await connection.request(
            `/api/orchestration/threads/${encodeURIComponent(thread.id)}/bounded`,
          ),
        );
        return {
          row,
          messages: messages(value.projection.visibleTurnItems),
          nextCursor: value.historyCursor,
        };
      }
      if (req.method !== "POST") throw new WatchError(404, "Unknown Watch operation.");
      if (match?.[3] === "voice" || newVoice) {
        const status = decodeSpeechStatus(
          await connection.request("/api/voice/status", { signal: cancelled.signal }),
        );
        if (!status.supported) throw new WatchError(503, status.reason);
        if (status.state === "missing-model")
          throw new WatchError(
            409,
            "Install a transcription model in this environment’s Voice settings, then retry. Your recording is kept.",
          );

        if (req.headers["content-type"] !== "audio/mp4" || !raw.length)
          throw new WatchError(400, "Upload an AAC recording.");
        const temporary = await NodeFSP.mkdtemp(NodePath.join(config.directory, "voice-"));
        try {
          await NodeFSP.writeFile(NodePath.join(temporary, "input.m4a"), raw, { mode: 0o600 });
          const info = await runFile("/usr/bin/afinfo", [NodePath.join(temporary, "input.m4a")], {
            timeout: 10_000,
            maxBuffer: 16384,
            signal: cancelled.signal,
          });
          const duration = Number(/estimated duration:\s*([\d.]+) sec/.exec(info.stdout)?.[1]);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
            throw new WatchError(400, "Recording must be under five minutes.");
          await runFile(
            "/usr/bin/afconvert",
            [
              "-f",
              "caff",
              "-d",
              "LEF32@16000",
              "-c",
              "1",
              NodePath.join(temporary, "input.m4a"),
              NodePath.join(temporary, "output.caf"),
            ],
            { timeout: 30_000, maxBuffer: 4096, signal: cancelled.signal },
          );
          const caf = await NodeFSP.readFile(NodePath.join(temporary, "output.caf"));
          let offset = 8;
          let pcm: Buffer | undefined;
          while (offset + 12 <= caf.length) {
            const type = caf.toString("ascii", offset, offset + 4);
            const size = Number(caf.readBigInt64BE(offset + 4));
            if (size < 0 || size > caf.length - offset - 12) break;
            if (type === "data") {
              pcm = caf.subarray(offset + 16, offset + 12 + size);
              break;
            }
            offset += size + 12;
          }
          if (!pcm?.length || pcm.length > 19_204_096)
            throw new WatchError(400, "Recording must be under five minutes.");
          const payload = encodeSpeechPcmRequest(pcm.subarray(0, 19_200_000), {
            ...DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
            speechLanguage: status.languages
              ? effectiveSpeechLanguage(
                  {
                    languages: status.languages,
                    supportsLanguageDetection: status.supportsLanguageDetection ?? false,
                  },
                  "auto",
                )
              : "auto",
          });
          const result = await connection.request("/api/voice/transcribe", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: payload,
            signal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(180_000)]),
          });
          const transcript = decodeWatchBoundary6(result);
          return { text: transcript.text, destination: `${e.config.name} · local T3 speech` };
        } finally {
          await NodeFSP.rm(temporary, { recursive: true, force: true });
        }
      }
      const body = decodeBody(JSON.parse(raw.toString()));
      const key = commandIdentity(grant.id, body);
      const commandId = revision(key);
      const target = newChat ? [url.pathname, e.config.environmentId, projectId] : [url.pathname];
      const fingerprint = revision([...target, body]);
      return once(key, fingerprint, async () => {
        if (newChat) {
          const p = e.projects.find((p) => p.id === projectId);
          if (!p || p.archivedAt) throw new WatchError(404, "Project is no longer available.");
          const currentConfig = await connection.config();
          const defaults = resolveProjectSettings(currentConfig.settings, p.id, p).settings;

          if (!defaults.defaultModelSelection || defaults.defaultThreadEnvMode !== "local")
            throw new WatchError(
              409,
              "Configure project defaults on iPhone. Worktree launch needs an explicit supported base.",
            );
          if (!body.text?.trim()) throw new WatchError(400, "Draft is empty.");
          const result = await connection.launch({
            commandId,
            threadId: `watch-${commandId}`,
            projectId,
            title: body.text.trim().slice(0, 80),
            generateTitle: true,
            creationSource: "mobile",
            modelSelection: defaults.defaultModelSelection,
            runtimeMode: defaults.defaultRuntimeMode,
            interactionMode: "default",
            workspaceStrategy: { type: "root" },
            initialMessage: { messageId: `watch-${commandId}`, text: body.text, attachments: [] },
          });
          return { environmentId: e.config.environmentId, threadId: result.threadId };
        }
        if (!thread) throw new WatchError(404, "Chat missing.");
        if (match?.[3] === "messages") {
          if (!body.text?.trim()) throw new WatchError(400, "Draft is empty.");
          if (thread.pendingRuntimeRequest)
            throw new WatchError(
              409,
              "Resolve the pending question or approval on iPhone or Mac first.",
            );
          await connection.dispatch({
            type: "message.dispatch",
            commandId,
            threadId,
            messageId: `watch-${commandId}`,
            text: body.text,
            attachments: [],
            creationSource: "mobile",
            dispatchMode: {
              type: ["preparing", "queued", "starting", "running", "waiting", "idle"].includes(
                thread.status,
              )
                ? "queue_after_active"
                : "start_immediately",
            },
          });
        } else if (match?.[3] === "shelf") {
          if (body.action === "undo") {
            const original = journal[`${grant.id}:${body.undoCommandId ?? ""}`]?.result;
            const receipt = decodeUndoReceipt(original);
            if (
              receipt.environmentId !== e.config.environmentId ||
              receipt.threadId !== threadId ||
              receipt.undoUntil < Date.now()
            )
              throw new WatchError(409, "Undo expired. Use Wake or Reopen in Details.");
            const base = { commandId, threadId };
            if (receipt.undoAction === "reopen")
              await connection.dispatch({
                ...base,
                type: "thread.unsettle",
                reason: "user",
                restoreUnsettledAt: receipt.restoreUnsettledAt,
              });
            else if (receipt.undoAction === "wake")
              await connection.dispatch({ ...base, type: "thread.unsnooze", reason: "user" });
            else if (receipt.undoAction === "settle")
              await connection.dispatch({
                ...base,
                type: "thread.settle",
                ...(thread.latestRunId ? { expectedLatestRunId: thread.latestRunId } : {}),
              });
            else if (
              receipt.undoAction === "snooze" &&
              receipt.restoreSnoozedUntil &&
              Date.parse(receipt.restoreSnoozedUntil) > Date.now()
            )
              await connection.dispatch({
                ...base,
                type: "thread.snooze",
                snoozedUntil: receipt.restoreSnoozedUntil,
              });
            else throw new WatchError(409, "The original snooze has expired. Choose a new preset.");
            return { environmentId: e.config.environmentId, threadId };
          }

          const row = rows.find(
            (r) => r.threadId === threadId && r.environmentId === e.config.environmentId,
          );
          if (body.action === "snooze" && !row?.canSnooze)
            throw new WatchError(409, "This chat cannot be snoozed right now.");
          if (body.action === "snooze") {
            if (![30, 60, 180].includes(body.minutes ?? 0))
              throw new WatchError(400, "Choose an available snooze preset.");
            await connection.dispatch({
              type: "thread.snooze",
              commandId,
              threadId,
              snoozedUntil: new Date(Date.now() + body.minutes! * 60_000).toISOString(),
            });
          } else if (body.action === "wake")
            await connection.dispatch({
              type: "thread.unsnooze",
              commandId,
              threadId,
              reason: "user",
            });
          else if (body.action === "settle")
            await connection.dispatch({
              type: "thread.settle",
              commandId,
              threadId,
              ...(thread.latestRunId ? { expectedLatestRunId: thread.latestRunId } : {}),
            });
          else if (body.action === "reopen")
            await connection.dispatch({
              type: "thread.unsettle",
              commandId,
              threadId,
              reason: "user",
              ...(body.restoreUnsettledAt === undefined
                ? {}
                : { restoreUnsettledAt: body.restoreUnsettledAt }),
            });
          else throw new WatchError(400, "Unknown shelf action.");
        } else throw new WatchError(404, "Unknown Watch operation.");
        return {
          environmentId: e.config.environmentId,
          threadId,
          ...(match?.[3] === "shelf"
            ? {
                undoAction:
                  body.action === "snooze"
                    ? "wake"
                    : body.action === "settle"
                      ? "reopen"
                      : body.action === "wake"
                        ? "snooze"
                        : "settle",
                undoUntil: Date.now() + 5000,
                restoreUnsettledAt: thread.unsettledAt
                  ? DateTime.formatIso(thread.unsettledAt)
                  : null,
                restoreSnoozedUntil: thread.snoozedUntil
                  ? DateTime.formatIso(thread.snoozedUntil)
                  : null,
              }
            : {}),
        };
      });
    })()
      .then((value) => {
        res.writeHead(200).end(JSON.stringify(value));
      })
      .catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(error instanceof WatchError ? error.status : 502);
        res.end(
          JSON.stringify({
            error:
              error instanceof WatchError
                ? error.message
                : "The destination did not accept this request. Your draft is kept.",
          }),
        );
      });
  });
  server.requestTimeout = 200_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  console.log(
    `Watch gateway listening on loopback port ${config.port}. HTTPS exposure is a separate deployment step.`,
  );
  const pushTimer = setInterval(() => {
    void push.deliver().catch(() => {
      console.error("Watch notification delivery failed; retained for retry.");
    });
  }, 2000);
  await Promise.all(watchers);
  clearInterval(pushTimer);
  await push.drain();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await serial;
}
void main().catch(() => {
  console.error(
    "Watch gateway stopped. Check private configuration and dedicated environment pairing.",
  );
  process.exitCode = 1;
});
