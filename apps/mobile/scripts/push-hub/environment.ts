import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeWS from "@effect/platform-node/NodeWS";
import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AuthAccessTokenType,
  type AuthEnvironmentScope,
  type ServerConfig,
  AuthOrchestrationReadScope,
  OrchestrationV2Command,
  OrchestrationV2ThreadLaunchInput,
  ThreadId,
  ExecutionEnvironmentDescriptor,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import {
  exchangeRemoteDpopAccessToken,
  issueRemoteDpopWebSocketTicket,
} from "@t3tools/client-runtime/authorization";
import { DpopProof } from "@t3tools/client-runtime/relay";
import { DpopPublicJwk } from "@t3tools/shared/dpop";
import * as Clock from "effect/Clock";
import * as Redacted from "effect/Redacted";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import { writePrivateJson } from "./store.ts";

export interface HubEnvironment {
  readonly environmentId: string;
  readonly origin: string;
  readonly credentialPath: string;
}
interface Credential {
  readonly privateKey: string;
  readonly accessToken: string;
  readonly expiresAt: number;
}
class HubStateError extends Schema.TaggedError<HubStateError>()("HubStateError", {}) {}
const clientMetadata = {
  label: "T3 Personal Notification Hub",
  surface: "cli",
  os: "macos",
  deviceType: "desktop",
} as const;
const runtime = Layer.mergeAll(FetchHttpClient.layer, PlatformNodeCrypto.layer);

const decodeDpopPublicJwk = Schema.decodeUnknownSync(DpopPublicJwk);
const decodeExecutionEnvironmentDescriptor = Schema.decodeUnknownSync(
  ExecutionEnvironmentDescriptor,
);
function proofKey(privateKey: string): DpopProof.DpopProofKey {
  const key = NodeCrypto.createPrivateKey(privateKey);
  return {
    publicJwk: decodeDpopPublicJwk(NodeCrypto.createPublicKey(key).export({ format: "jwk" })),
    sign: (input) =>
      Effect.try({
        try: () => NodeCrypto.sign("sha256", input, { key, dsaEncoding: "ieee-p1363" }),
        catch: () =>
          new DpopProof.DpopProofError({ message: "Could not sign the hub connection proof" }),
      }),
  };
}

const decodeWatchBoundary0 = Schema.decodeUnknownSync(OrchestrationV2Command);
const decodeWatchBoundary1 = Schema.decodeUnknownSync(OrchestrationV2ThreadLaunchInput);

export interface HubConnection {
  config: () => Promise<ServerConfig>;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  dispatch: (command: unknown) => Promise<unknown>;
  launch: (input: unknown) => Promise<{ threadId: string }>;
}

export async function pairEnvironment(
  environment: HubEnvironment,
  bootstrapToken: string,
  scopes: readonly AuthEnvironmentScope[] = [AuthOrchestrationReadScope],
): Promise<void> {
  const response = await fetch(new URL("/.well-known/t3/environment", environment.origin), {
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const descriptor = decodeExecutionEnvironmentDescriptor(await response.json());
  if (descriptor.environmentId !== environment.environmentId)
    throw new Error("The pairing address belongs to a different environment");
  if (!descriptor.capabilities.accessTokenRenewal)
    throw new Error(
      "Update this host before pairing the notification hub: renewable device sessions are required",
    );
  const privateKey = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const key = proofKey(privateKey);
  const token = await Effect.runPromise(
    Effect.gen(function* () {
      const dpopProof = yield* DpopProof.createProof({
        key,
        method: "POST",
        url: new URL("/oauth/token", environment.origin).href,
      });
      return yield* exchangeRemoteDpopAccessToken({
        httpBaseUrl: environment.origin,
        credential: bootstrapToken,
        dpopProof,
        scopes,
        clientMetadata,
      });
    }).pipe(Effect.provide(runtime)),
  );
  await writePrivateJson(environment.credentialPath, {
    privateKey,
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  });
}

export async function watchEnvironment(
  environment: HubEnvironment,
  onItem: (
    item: OrchestrationV2ShellStreamItem,
    readQuestion: (threadId: string, requestId: string) => Promise<string | undefined>,
  ) => Promise<void>,
  signal: AbortSignal,
  onConnected?: (connection: HubConnection) => void,
): Promise<void> {
  const stored = JSON.parse(
    await NodeFSP.readFile(environment.credentialPath, "utf8"),
  ) as Credential;
  const key = proofKey(stored.privateKey);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let credential = stored;
        if (credential.expiresAt - (yield* Clock.currentTimeMillis) < 5 * 60_000) {
          const proof = yield* DpopProof.createProof({
            key,
            method: "POST",
            url: new URL("/oauth/token", environment.origin).href,
          });
          const renewed = yield* exchangeRemoteDpopAccessToken({
            httpBaseUrl: environment.origin,
            credential: credential.accessToken,
            credentialType: AuthAccessTokenType,
            dpopProof: proof,
          });
          credential = {
            ...credential,
            accessToken: renewed.access_token,
            expiresAt: (yield* Clock.currentTimeMillis) + renewed.expires_in * 1000,
          };
          yield* Effect.promise(() => writePrivateJson(environment.credentialPath, credential));
        }
        const ticketUrl = new URL("/api/auth/websocket-ticket", environment.origin);
        const proof = yield* DpopProof.createProof({
          key,
          method: "POST",
          url: ticketUrl.href,
          accessToken: credential.accessToken,
        });
        const ticket = yield* issueRemoteDpopWebSocketTicket({
          httpBaseUrl: environment.origin,
          accessToken: credential.accessToken,
          dpopProof: proof,
        });
        const socketUrl = new URL("/ws", environment.origin);
        socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
        socketUrl.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
        socketUrl.searchParams.set("wsTicket", Redacted.value(ticket.ticket));
        const protocol = yield* Layer.build(
          RpcClient.layerProtocolSocket().pipe(
            Layer.provide(Socket.layerWebSocket(socketUrl.href)),
            Layer.provide(RpcSerialization.layerJson),
            Layer.provide(NodeWS.layerWebSocketConstructor),
          ),
        );
        const client = yield* RpcClient.make(WsRpcGroup).pipe(Effect.provideContext(protocol));
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const readQuestion = async (threadId: string, requestId: string) => {
          const snapshot = await runPromise(
            client["orchestration.subscribeThread"]({
              threadId: ThreadId.make(threadId),
              acceptBoundedSnapshot: true,
            }).pipe(
              Stream.filter((item) => item.kind === "snapshot"),
              Stream.runHead,
              Effect.timeout("5 seconds"),
            ),
            { signal },
          );
          if (Option.isNone(snapshot) || snapshot.value.kind !== "snapshot") return undefined;
          const projection = snapshot.value.projection;
          const items = [
            ...projection.turnItems,
            ...projection.visibleTurnItems.map((value) => value.item),
          ];
          const question = items.find(
            (item) => item.type === "user_input_request" && item.requestId === requestId,
          );
          return question?.type === "user_input_request"
            ? question.questions.map((item) => item.question).join(" ")
            : undefined;
        };
        onConnected?.({
          config: () => runPromise(client["server.getConfig"]({}), { signal }),
          request: async (path, init = {}) => {
            const url = new URL(path, environment.origin);
            if (url.origin !== new URL(environment.origin).origin)
              throw new Error("Invalid destination");
            const proof = await runPromise(
              DpopProof.createProof({
                key,
                method: init.method ?? "GET",
                url: url.href,
                accessToken: credential.accessToken,
              }).pipe(Effect.provide(runtime)),
            );
            const headers = new Headers(init.headers);
            headers.set("authorization", `DPoP ${credential.accessToken}`);
            headers.set("dpop", proof);
            headers.set("x-t3-orchestration-protocol", String(ORCHESTRATION_PROTOCOL_VERSION));
            const response = await fetch(url, {
              ...init,
              headers,
              redirect: "error",
              signal: AbortSignal.any([signal, init.signal ?? AbortSignal.timeout(30_000)]),
            });
            if (!response.ok) throw new Error(`Environment request failed (${response.status})`);
            return response.json();
          },
          dispatch: (command) =>
            runPromise(client["orchestration.dispatchCommand"](decodeWatchBoundary0(command)), {
              signal,
            }),
          launch: (input) =>
            runPromise(client["orchestration.launchThread"](decodeWatchBoundary1(input)), {
              signal,
            }),
        });
        // Reconnect before token expiry so a sleeping environment never strands an expired socket.
        yield* client["orchestration.subscribeShell"]({}).pipe(
          Stream.runForEach((item) =>
            Effect.tryPromise({
              try: () => onItem(item, readQuestion),
              catch: () => new HubStateError(),
            }),
          ),
          Effect.timeout(
            `${Math.max(30_000, credential.expiresAt - (yield* Clock.currentTimeMillis) - 120_000)} millis`,
          ),
        );
      }),
    ).pipe(Effect.provide(runtime)),
    { signal },
  );
}
