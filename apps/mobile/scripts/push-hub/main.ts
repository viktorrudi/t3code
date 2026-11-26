import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { EnvironmentId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { hubOrigin } from "../../src/features/personal-push/protocol.ts";
import { hashCredential, matchesCredential, registerDevice } from "./api.ts";
import { makeApnsSender } from "./apns.ts";
import { prepareDelivery, finishDelivery } from "./delivery.ts";
import { pairEnvironment, watchEnvironment } from "./environment.ts";
import { notificationCandidates, plainPreview } from "./notifications.ts";
import { updateNotificationThreads } from "./shell.ts";
import { observeCandidates, readHubState, writePrivateJson } from "./store.ts";

const Config = Schema.Struct({
  directory: Schema.String,
  publicOrigin: Schema.String,
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1024, maximum: 65535 })),
  apns: Schema.Struct({
    keyPath: Schema.String,
    keyId: Schema.String,
    teamId: Schema.String,
    bundleId: Schema.Literal("com.viktorrudi.t3code"),
  }),
  environments: Schema.Array(
    Schema.Struct({
      environmentId: EnvironmentId,
      name: Schema.String,
      origin: Schema.String,
      credentialPath: Schema.String,
    }),
  ),
});
const Invitation = Schema.Struct({ hash: Schema.String, expiresAt: Schema.Number });

class HubStorageError extends Schema.TaggedError<HubStorageError>()("HubStorageError", {
  cause: Schema.Defect(),
}) {}

const isHubStorageError = Schema.is(HubStorageError);
const decodeConfig = Schema.decodeUnknownSync(Config);
const decodeInvitation = Schema.decodeUnknownSync(Invitation);
async function main() {
  const [command, configPath, environmentId, bootstrapPath] = process.argv.slice(2);
  if (!configPath || !["run", "invite", "pair", "status"].includes(command ?? ""))
    throw new Error(
      "Usage: hub <run|invite|pair|status> <absolute-config-path> [environment-id bootstrap-token-file]",
    );
  const config = decodeConfig(JSON.parse(await NodeFSP.readFile(configPath, "utf8")));
  hubOrigin(config.publicOrigin);
  if (
    ![
      config.directory,
      config.apns.keyPath,
      ...config.environments.map((environment) => environment.credentialPath),
    ].every(NodePath.isAbsolute)
  )
    throw new Error("Hub storage and credential paths must be absolute");
  for (const environment of config.environments) {
    const url = new URL(environment.origin);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Environment origins must use HTTPS or loopback HTTP");
  }
  const statePath = NodePath.join(config.directory, "state.json");
  const invitationPath = NodePath.join(config.directory, "invitation.json");
  if (command === "pair") {
    const environment = config.environments.find((value) => value.environmentId === environmentId);
    if (!environment || !bootstrapPath)
      throw new Error("Choose a configured environment and a private bootstrap-token file");
    await pairEnvironment(environment, (await NodeFSP.readFile(bootstrapPath, "utf8")).trim());
    console.log("Read-only notification session paired.");
    return;
  }
  if (command === "invite") {
    const credential = NodeCrypto.randomBytes(32).toString("base64url");
    await writePrivateJson(invitationPath, {
      hash: hashCredential(credential),
      expiresAt: Date.now() + 15 * 60_000,
    });
    const destination = NodePath.join(config.directory, "phone-invitation.json");
    await writePrivateJson(destination, {
      invitation: `${config.publicOrigin}/#t3-notifications=${credential}`,
    });
    console.log(`One-use phone invitation saved to ${destination}; expires in 15 minutes.`);
    return;
  }
  if (command === "status") {
    console.log(await NodeFSP.readFile(NodePath.join(config.directory, "health.json"), "utf8"));
    return;
  }
  await NodeFSP.mkdir(config.directory, { recursive: true, mode: 0o700 });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  {
    if (config.environments.length === 0) throw new Error("Configure at least one environment");
    const state = await readHubState(statePath);
    const health = {
      environments: config.environments.map((environment) => ({
        environmentId: environment.environmentId,
        name: environment.name,
        connected: false,
      })),
      deliveryError: null as string | null,
    };
    let serial = Promise.resolve();
    const transact = <T>(operation: () => Promise<T>) => {
      const next = serial.then(operation);
      serial = next.then(
        () => {},
        () => {},
      );
      return next;
    };
    const persist = async () => {
      try {
        await writePrivateJson(statePath, state);
      } catch (error) {
        health.deliveryError = "Notification storage failed; check the hub log.";
        throw new HubStorageError({ cause: error });
      }
    };
    const server = NodeHttp.createServer((request, response) => {
      void (async () => {
        if (request.headers.origin) {
          response.writeHead(403).end();
          return;
        }
        const authorization = request.headers.authorization;
        const credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) {
          response.writeHead(401).end();
          return;
        }
        let text = "";
        for await (const chunk of request) {
          text += chunk.toString();
          if (Buffer.byteLength(text) > 4096) {
            response.writeHead(413).end();
            request.destroy();
            return;
          }
        }
        await transact(async () => {
          const device = state.devices.find((value) =>
            matchesCredential(credential, value.credentialHash),
          );
          if (request.method === "POST" && request.url === "/register") {
            let invitation: typeof Invitation.Type | null = null;
            try {
              invitation = decodeInvitation(
                JSON.parse(await NodeFSP.readFile(invitationPath, "utf8")),
              );
            } catch {
              /* No active phone invitation. */
            }
            const previousDevices = state.devices;
            const consumed = registerDevice(
              state,
              JSON.parse(text),
              credential,
              invitation,
              Date.now(),
            );
            try {
              await persist();
            } catch (error) {
              state.devices = previousDevices;
              throw error;
            }
            if (consumed) {
              await NodeFSP.rm(invitationPath, { force: true });
              await NodeFSP.rm(NodePath.join(config.directory, "phone-invitation.json"), {
                force: true,
              });
            }
            response
              .writeHead(200, { "Content-Type": "application/json" })
              .end(JSON.stringify(health));
          } else if (device && request.method === "DELETE" && request.url === "/register") {
            const previousDevices = state.devices;
            const previousPending = state.pending;
            state.devices = state.devices.filter((value) => value.id !== device.id);
            state.pending = state.pending.filter((value) => value.deviceId !== device.id);
            try {
              await persist();
            } catch (error) {
              state.devices = previousDevices;
              state.pending = previousPending;
              throw error;
            }
            response.writeHead(204).end();
          } else if (device && request.method === "GET" && request.url === "/status") {
            response
              .writeHead(200, { "Content-Type": "application/json" })
              .end(JSON.stringify(health));
          } else response.writeHead(401).end();
        });
      })().catch((error: unknown) => {
        if (!response.headersSent)
          response.writeHead(
            isHubStorageError(error)
              ? 503
              : error instanceof Error && error.message === "Unauthorized"
                ? 401
                : 400,
          );
        response.end();
      });
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", resolve);
    });
    const send = makeApnsSender(config.apns);
    let delivering = false;
    let lastHealthWrite = 0;
    const timer = setInterval(() => {
      if (delivering) return;
      delivering = true;
      void (async () => {
        const delivery = await transact(async () => prepareDelivery(state, Date.now()));
        if (delivery) {
          const result = await send(
            delivery.device.token,
            delivery.job.candidate,
            delivery.device.preview,
          ).catch(() => ({ status: 503, reason: "TransportUnavailable" }));
          await transact(async () => {
            health.deliveryError = finishDelivery(state, delivery, Date.now(), result);
            await persist();
          });
        }
        if (Date.now() - lastHealthWrite >= 30_000) {
          await writePrivateJson(NodePath.join(config.directory, "health.json"), {
            ...health,
            checkedAt: new Date().toISOString(),
            queued: state.pending.length,
          });
          lastHealthWrite = Date.now();
        }
      })()
        .catch(() => {
          console.error("Could not persist notification delivery state.");
        })
        .finally(() => {
          delivering = false;
        });
    }, 2000);
    const watchers = config.environments.map(async (environment, index) => {
      while (!shutdown.signal.aborted) {
        const threads = new Map<string, OrchestrationV2ThreadShell>();
        let initialized = false;
        try {
          await watchEnvironment(
            environment,
            async (item, readQuestion) => {
              const first = !initialized;
              if (!updateNotificationThreads(threads, item)) return;
              if (item.kind === "snapshot") initialized = true;
              if (!initialized) return;
              health.environments[index]!.connected = true;
              const candidates = notificationCandidates(
                environment.environmentId,
                threads,
                Date.now(),
              );
              const enriched: Array<(typeof candidates)[number]> = [];
              for (const candidate of candidates) {
                const previous =
                  state.observed[`${environment.environmentId}:${candidate.threadId}`];
                const question =
                  candidate.question &&
                  previous !== candidate.key &&
                  (!first || state.seeded[environment.environmentId])
                    ? await readQuestion(
                        candidate.question.threadId,
                        candidate.question.requestId,
                      ).catch(() => undefined)
                    : undefined;
                enriched.push(
                  question ? { ...candidate, body: plainPreview(question) } : candidate,
                );
              }
              await transact(async () => {
                if (
                  observeCandidates(
                    state,
                    environment.environmentId,
                    enriched,
                    [...threads.keys()],
                    Date.now(),
                    first,
                  )
                )
                  await persist();
              });
            },
            shutdown.signal,
          );
        } catch {
          health.environments[index]!.connected = false;
        }
        if (!shutdown.signal.aborted)
          await new Promise<void>((resolve) => {
            const reconnect = setTimeout(done, 10_000);
            function done() {
              clearTimeout(reconnect);
              shutdown.signal.removeEventListener("abort", done);
              resolve();
            }
            shutdown.signal.addEventListener("abort", done, { once: true });
          });
      }
    });
    await Promise.all(watchers);
    clearInterval(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await serial;
  }
}

void main().catch(() => {
  console.error(
    "Notification hub stopped. Check config, pairing credentials, key permissions and the listening port.",
  );
  process.exitCode = 1;
});
