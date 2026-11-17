// @effect-diagnostics nodeBuiltinImport:off - Private Unix-domain transport; no HTTP/browser listener.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  PATTERN_READER_FRAME_BYTES,
  PATTERN_READER_TIMEOUT_MS,
  PatternReaderError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
import * as PatternReader from "./PatternReader.ts";

const read = (socket: NodeNet.Socket) =>
  Effect.callback<Uint8Array, PatternReaderError>((resume) => {
    let bytes = Buffer.alloc(0);
    const fail = () => resume(Effect.fail(new PatternReaderError({ code: "invalid_response" })));
    const data = (chunk: Buffer) => {
      if (bytes.length + chunk.length > PATTERN_READER_FRAME_BYTES + 4) return fail();
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4) return;
      const length = bytes.readUInt32BE();
      if (length === 0 || length > PATTERN_READER_FRAME_BYTES || bytes.length > length + 4)
        return fail();
      if (bytes.length === length + 4) {
        socket.pause();
        resume(Effect.succeed(bytes.subarray(4)));
      }
    };
    socket.on("data", data);
    socket.once("error", fail);
    socket.once("close", fail);
    socket.once("end", fail);
    return Effect.sync(() => {
      socket.off("data", data);
      socket.off("error", fail);
      socket.off("close", fail);
      socket.off("end", fail);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () => Effect.fail(new PatternReaderError({ code: "timeout" })),
    }),
  );

const abandoned = (socket: NodeNet.Socket) =>
  Effect.callback<never, PatternReaderError>((resume) => {
    const stop = () => resume(Effect.fail(new PatternReaderError({ code: "provider_failed" })));
    socket.once("close", stop);
    socket.once("end", stop);
    socket.once("error", stop);
    socket.once("data", stop);
    socket.resume();
    return Effect.sync(() => {
      socket.off("close", stop);
      socket.off("end", stop);
      socket.off("error", stop);
      socket.off("data", stop);
    });
  });

const write = (socket: NodeNet.Socket, value: unknown) =>
  Effect.callback<void, PatternReaderError>((resume) => {
    const bytes = Buffer.from(encodeJson(value));
    const fail = () => resume(Effect.fail(new PatternReaderError({ code: "provider_failed" })));
    if (socket.destroyed || bytes.length > PATTERN_READER_FRAME_BYTES) return fail();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length);
    socket.once("error", fail);
    socket.once("close", fail);
    socket.end(Buffer.concat([header, bytes]), () => resume(Effect.void));
    return Effect.sync(() => {
      socket.off("error", fail);
      socket.off("close", fail);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 5_000,
      orElse: () => Effect.fail(new PatternReaderError({ code: "timeout" })),
    }),
  );

export const start = Effect.fn("PatternReaderSocket.start")(function* (endpoint: string) {
  const reader = yield* PatternReader.PatternReader;
  const uid = yield* HostProcess.UserId;
  const platform = yield* HostProcess.Platform;
  const io = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: () => new PatternReaderError({ code: "not_configured" }),
    });
  yield* io(async () => {
    if (
      platform === "win32" ||
      uid === undefined ||
      !NodePath.isAbsolute(endpoint) ||
      Buffer.byteLength(endpoint) > 100
    )
      throw new Error("Unsupported endpoint");
    const directory = NodePath.dirname(endpoint);
    if ((await NodeFSP.realpath(directory)) !== directory)
      throw new Error("Noncanonical directory");
    const parent = await NodeFSP.lstat(directory);
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== uid ||
      (parent.mode & 0o777) !== 0o700
    )
      throw new Error("Unprotected directory");
    // Never remove an existing endpoint, even a stale socket owned by this uid.
    try {
      await NodeFSP.lstat(endpoint);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error("Existing endpoint");
  });
  const connections = yield* FiberSet.make<void>();
  const run = yield* FiberSet.runtime(connections)();
  const sockets = new Set<NodeNet.Socket>();
  let ready = false;
  const server = NodeNet.createServer((socket) => {
    socket.on("error", () => {});
    if (!ready || sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    run(
      Effect.gen(function* () {
        const payload = yield* read(socket);
        return yield* Effect.raceFirst(reader.handle(payload), abandoned(socket));
      }).pipe(
        Effect.timeoutOrElse({
          duration: PATTERN_READER_TIMEOUT_MS,
          orElse: () => Effect.fail(new PatternReaderError({ code: "timeout" })),
        }),
        Effect.matchEffect({
          onSuccess: (result) => write(socket, result),
          onFailure: (error) => write(socket, { error: { code: error.code } }),
        }),
        Effect.ignoreCause,
        Effect.ensuring(Effect.sync(() => socket.destroy())),
      ),
    );
  });
  server.on("error", () => {});
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      ready = false;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
  yield* Effect.callback<void, PatternReaderError>((resume) => {
    const fail = () => resume(Effect.fail(new PatternReaderError({ code: "not_configured" })));
    server.once("error", fail);
    server.listen(endpoint, () => resume(Effect.void));
    return Effect.sync(() => server.off("error", fail));
  });
  yield* io(async () => {
    await NodeFSP.chmod(endpoint, 0o600);
    const socket = await NodeFSP.lstat(endpoint);
    if (!socket.isSocket() || socket.uid !== uid || (socket.mode & 0o777) !== 0o600)
      throw new Error("Unprotected socket");
  });
  ready = true;
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* HostProcess.Environment;
    const endpoint = environment.T3CODE_PATTERN_READER_SOCKET;
    const fingerprint = environment.T3CODE_PATTERN_READER_ACCOUNT_FINGERPRINT;
    if (!endpoint || !fingerprint) return Layer.empty;
    return Layer.effectDiscard(start(endpoint)).pipe(
      Layer.provide(PatternReader.layer(fingerprint)),
    );
  }),
);
