// @effect-diagnostics nodeBuiltinImport:off - Real private IPC fixture, never the running T3 server.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { PATTERN_READER_MODEL, PATTERN_READER_PROVIDER } from "@t3tools/contracts";
import * as PatternReader from "./PatternReader.ts";
import * as PatternReaderSocket from "./PatternReaderSocket.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const response = {
  transport_evidence: {
    protocol: "threadwise-reader-v1" as const,
    backend: "codex-t3" as const,
    provider_instance_id: PATTERN_READER_PROVIDER,
    model: PATTERN_READER_MODEL,
    auth_mode: "chatgpt-subscription-sharing" as const,
    account_fingerprint: "a".repeat(64),
    tools_disabled: true as const,
    request_id: "fixture",
    request_sha256: "b".repeat(64),
    max_output_tokens_semantics: "result-acceptance-only" as const,
    generation_tokens_capped: false as const,
  },
} as const;
const frame = (body: string) => {
  const bytes = Buffer.from(body);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  return Buffer.concat([header, bytes]);
};
const directory = Effect.acquireRelease(
  Effect.promise(async () => {
    const path = await NodeFSP.mkdtemp("/tmp/t3-pr-");
    await NodeFSP.chmod(path, 0o700);
    return NodeFSP.realpath(path);
  }),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);
const exchange = (endpoint: string, chunks: Buffer[]) =>
  Effect.promise(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        const socket = NodeNet.connect(endpoint);
        const received: Buffer[] = [];
        socket.on("data", (chunk) => received.push(chunk));
        socket.once("error", reject);
        socket.once("close", () => resolve(Buffer.concat(received)));
        socket.once("connect", () => {
          for (const chunk of chunks) socket.write(chunk);
        });
      }),
  );

it.live(
  "uses owner-only Unix framing, rejects extra/oversized frames, and removes its listener on close",
  () =>
    Effect.gen(function* () {
      const parent = yield* directory;
      const endpoint = `${parent}/s`;
      const accepted: string[] = [];
      yield* Effect.gen(function* () {
        yield* PatternReaderSocket.start(endpoint);
        const stat = yield* Effect.promise(() => NodeFSP.lstat(endpoint));
        assert.equal(stat.mode & 0o777, 0o600);
        assert.equal(stat.uid, process.getuid!());
        const input = frame('{"operation":"status"}');
        const output = yield* exchange(endpoint, [input.subarray(0, 2), input.subarray(2)]);
        assert.equal(output.readUInt32BE(), output.length - 4);
        assert.equal(output.subarray(4).toString(), encode(response));
        assert.deepEqual(accepted, ['{"operation":"status"}']);
        const huge = Buffer.alloc(4);
        huge.writeUInt32BE(1024 * 1024 + 1);
        for (const invalid of [huge, Buffer.concat([input, input])]) {
          const rejected = yield* exchange(endpoint, [invalid]);
          assert.equal(rejected.subarray(4).toString(), '{"error":{"code":"invalid_response"}}');
        }
        assert.lengthOf(accepted, 1);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mock(PatternReader.PatternReader)({
            handle: (payload) =>
              Effect.sync(() => {
                accepted.push(Buffer.from(payload).toString());
                return response;
              }),
          }),
        ),
      );
      assert.isFalse(
        yield* Effect.promise(() =>
          NodeFSP.lstat(endpoint).then(
            () => true,
            () => false,
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.live.each(["public-parent", "existing-file", "symlink-parent"])(
  "refuses unsafe endpoint %s without deleting existing state",
  (mode) =>
    Effect.gen(function* () {
      const parent = yield* directory;
      let endpoint = `${parent}/s`;
      if (mode === "public-parent") yield* Effect.promise(() => NodeFSP.chmod(parent, 0o755));
      if (mode === "existing-file")
        yield* Effect.promise(() => NodeFSP.writeFile(endpoint, "preserve"));
      if (mode === "symlink-parent") {
        yield* Effect.promise(() => NodeFSP.symlink(parent, `${parent}/alias`));
        endpoint = `${parent}/alias/s`;
      }
      const error = yield* Effect.flip(PatternReaderSocket.start(endpoint));
      assert.equal(error.code, "not_configured");
      if (mode === "existing-file")
        assert.equal(yield* Effect.promise(() => NodeFSP.readFile(endpoint, "utf8")), "preserve");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mock(PatternReader.PatternReader)({ handle: () => Effect.die("unused") }),
      ),
    ),
);

it.live("disconnect cancels the active provider effect and releases the connection", () =>
  Effect.gen(function* () {
    const parent = yield* directory;
    const endpoint = `${parent}/s`;
    const started = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      yield* PatternReaderSocket.start(endpoint);
      const socket = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<NodeNet.Socket>((resolve, reject) => {
              const client = NodeNet.connect(endpoint, () => resolve(client));
              client.once("error", reject);
            }),
        ),
        (client) => Effect.sync(() => client.destroy()),
      );
      socket.write(frame("{}"));
      yield* Deferred.await(started);
      socket.destroy();
      yield* Deferred.await(cancelled);
    }).pipe(
      Effect.provide(
        Layer.mock(PatternReader.PatternReader)({
          handle: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(cancelled, undefined)),
            ),
        }),
      ),
    );
  }).pipe(Effect.scoped),
);
