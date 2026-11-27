// Turn admission through the per-user skills common lock. The layout and rules
// match workstation/environments/common-lock.mjs in the skills repository: a run
// holds one turn reader for its whole lifecycle, a skills apply holds the writer,
// and neither starts while the other is present.
import * as NodeOS from "node:os";

import type { EnvironmentId, RunId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../processRunner.ts";

const PROTOCOL_VERSION = 1;
const GUARD_VERSION = 1;
// A writer that crashed sends no file event; re-check liveness at this pace while waiting.
const STALE_RECHECK = Duration.seconds(15);

export interface LockProbe {
  /** false when the pid is provably gone, null when unknown. */
  readonly exists: (pid: number) => Effect.Effect<boolean | null>;
  readonly start: (pid: number) => Effect.Effect<string | null>;
}

const admitWithoutLock = Effect.fn("SkillsAdmission.admitWithoutLock")(function* () {});

// Off by default so tests and CLIs never touch the account's real lock; the
// native server provides `layer`.
export class SkillsAdmission extends Context.Reference<{
  /** Holds a turn reader in the caller's scope; waits while a skills apply runs. */
  readonly admitTurn: (input: {
    readonly runId: RunId;
    readonly onWait: Effect.Effect<void>;
  }) => Effect.Effect<void, never, Scope.Scope>;
}>("t3/personal/SkillsAdmission", { defaultValue: () => ({ admitTurn: admitWithoutLock }) }) {}

const defaultLockDirectory = (home = NodeOS.userInfo().homedir) =>
  `${home}/.local/state/skills/common-lock`;

const Holder = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  start: Schema.String,
  nonce: Schema.optional(Schema.String),
});
type Holder = typeof Holder.Type;
const Protocol = Schema.Struct({ version: Schema.Number });
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeHolder = Schema.decodeUnknownEffect(Schema.fromJsonString(Holder));
const decodeProtocol = Schema.decodeUnknownEffect(Schema.fromJsonString(Protocol));

const makeSystemProbe = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = HostProcess.Platform.defaultValue();
  const probe: LockProbe = {
    exists: (pid) =>
      Effect.sync(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ESRCH" ? false : null;
        }
      }),
    start: (pid) => {
      if (platform === "darwin") {
        // lstart prints in the caller's zone and locale; fix both like the skills helper.
        return runner
          .run({
            command: "/bin/ps",
            args: ["-o", "lstart=", "-p", String(pid)],
            env: { PATH: "/usr/bin:/bin", TZ: "UTC0", LC_ALL: "C" },
            timeout: "10 seconds",
          })
          .pipe(
            Effect.map((output) =>
              output.code === 0 && output.stdout.trim() ? output.stdout.trim() : null,
            ),
            Effect.orElseSucceed(() => null),
          );
      }
      if (platform === "linux") {
        return Effect.gen(function* () {
          const stat = yield* fileSystem.readFileString(`/proc/${pid}/stat`);
          const boot = yield* fileSystem.readFileString("/proc/sys/kernel/random/boot_id");
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          return `${boot.trim()}:${fields[19]}`;
        }).pipe(Effect.orElseSucceed(() => null));
      }
      return Effect.succeed(null);
    },
  };
  return probe;
});

interface AdmissionOptions {
  readonly directory?: string;
  readonly probe: LockProbe;
  readonly environmentId: EnvironmentId;
  readonly serverVersion: string;
}

const makeReady = Effect.fn("SkillsAdmission.makeReady")(function* (options: AdmissionOptions) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const { probe } = options;
  const directory =
    options.directory ??
    (yield* Effect.try({
      try: () => defaultLockDirectory(),
      catch: () => "local-home" as const,
    }));
  const start = yield* probe.start(process.pid);
  if (start === null) {
    return yield* Effect.fail("process-start" as const);
  }
  const self = { pid: process.pid, start };

  // undefined when absent; null when unreadable or malformed (never stale, never free).
  const readHolder = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.flatMap((text) => decodeHolder(text)),
      Effect.map((holder): Holder | null | undefined => holder),
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.succeed(error.reason._tag === "NotFound" ? undefined : null),
        SchemaError: () => Effect.succeed(null),
      }),
    );
  const writeDurable = Effect.fn("SkillsAdmission.writeDurable")(function* (
    temp: string,
    text: string,
  ) {
    const file = yield* fileSystem.open(temp, { flag: "wx", mode: 0o600 });
    yield* file.writeAll(new TextEncoder().encode(`${text}\n`));
    yield* file.sync;
  }, Effect.scoped);
  const removeLockFile = (file: string) =>
    fileSystem.remove(file, { force: true }).pipe(Effect.ignoreCause({ log: true }));
  const writeAtomically = Effect.fn("SkillsAdmission.writeAtomically")(function* (
    sub: string,
    prefix: string,
    data: object,
  ) {
    const id = yield* random.uuidV4();
    const temp = path.join(directory, sub, `${prefix}${self.pid}-${id}`);
    const file = path.join(directory, sub, `${id}.json`);
    const text = yield* encodeJson({ nonce: id, ...self, ...data }).pipe(Effect.orDie);
    yield* writeDurable(temp, text).pipe(
      Effect.andThen(fileSystem.rename(temp, file)),
      Effect.onExit(() => removeLockFile(temp)),
    );
    return file;
  });
  const isStale = Effect.fn("SkillsAdmission.isStale")(function* (holder: Holder) {
    const exists = yield* probe.exists(holder.pid);
    if (exists === false) return true;
    const current = yield* probe.start(holder.pid);
    return current !== null && current !== holder.start;
  });
  const open = Effect.fn("SkillsAdmission.open")(function* () {
    for (const sub of ["", "capabilities", "readers"]) {
      yield* fileSystem.makeDirectory(path.join(directory, sub), { recursive: true, mode: 0o700 });
    }
    const protocol = path.join(directory, "protocol.json");
    if (!(yield* fileSystem.exists(protocol))) {
      const temp = path.join(directory, `.protocol.tmp-${yield* random.uuidV4()}`);
      const text = yield* encodeJson({ version: PROTOCOL_VERSION }).pipe(Effect.orDie);
      yield* writeDurable(temp, text).pipe(
        Effect.andThen(
          fileSystem.link(temp, protocol).pipe(
            Effect.catchTags({
              PlatformError: (error) =>
                error.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(error),
            }),
          ),
        ),
        Effect.onExit(() => removeLockFile(temp)),
      );
    }
    return yield* fileSystem.readFileString(protocol).pipe(
      Effect.flatMap((text) => decodeProtocol(text)),
      Effect.map((value) => value.version === PROTOCOL_VERSION),
      Effect.catchTags({ SchemaError: () => Effect.succeed(false) }),
    );
  });
  // free | held | stale | unknown, as writerState in common-lock.mjs. An empty
  // writer/ is a crash leftover; rename() replaces it, so it counts as free.
  const writerState = Effect.fn("SkillsAdmission.writerState")(function* () {
    const names = yield* fileSystem.readDirectory(path.join(directory, "writer")).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
      }),
    );
    const name = names[0];
    if (name === undefined) return { state: "free" as const };
    if (names.length !== 1 || !name.endsWith(".json")) return { state: "unknown" as const };
    const owner = yield* readHolder(path.join(directory, "writer", name));
    if (!owner || owner.nonce !== name.slice(0, -5)) return { state: "unknown" as const };
    return { state: (yield* isStale(owner)) ? ("stale" as const) : ("held" as const), owner };
  });
  // Removes only the judged owner's file; a newer writer is never touched.
  const clearStaleWriter = (owner: Holder) =>
    fileSystem.remove(path.join(directory, "writer", `${owner.nonce}.json`), { force: true });

  if (!(yield* open())) return yield* Effect.fail("protocol" as const);
  if ((yield* writerState()).state === "unknown")
    return yield* Effect.fail("writer-unknown" as const);
  yield* Effect.acquireRelease(
    writeAtomically("capabilities", ".capability.tmp-", {
      kind: "server",
      info: {
        environmentId: options.environmentId,
        serverVersion: options.serverVersion,
        guardVersion: GUARD_VERSION,
      },
    }),
    removeLockFile,
  );

  const writerAllowsReaders = open().pipe(
    Effect.flatMap((known) =>
      known
        ? writerState().pipe(Effect.map(({ state }) => state === "free" || state === "stale"))
        : Effect.succeed(false),
    ),
    Effect.orElseSucceed(() => false),
  );
  const waitForChange = Effect.fn("SkillsAdmission.waitForChange")(
    function* () {
      const changed = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      yield* fileSystem
        .watch(directory, {
          recursive: true,
          onReady: () => Deferred.doneUnsafe(ready, Effect.void),
        })
        .pipe(
          Stream.filter(
            ({ path }) =>
              path === "protocol.json" ||
              path === "writer" ||
              path.startsWith("writer/") ||
              path.startsWith("writer.tmp-"),
          ),
          Stream.take(1),
          Stream.tap(() => Deferred.succeed(changed, undefined)),
          Stream.runDrain,
          Effect.ignore,
          Effect.forkScoped,
        );
      yield* Deferred.await(ready);
      // Re-check after the watcher is installed so a release in between is not missed.
      if (yield* writerAllowsReaders) return;
      yield* Deferred.await(changed);
    },
    Effect.scoped,
    Effect.timeoutOption(STALE_RECHECK),
  );

  const tryAdmit = Effect.fn("SkillsAdmission.tryAdmit")(function* (runId: RunId) {
    if (!(yield* open())) return "protocol" as const;
    const created = DateTime.formatIso(yield* DateTime.now);
    let transferred = false;
    return yield* Effect.acquireUseRelease(
      writeAtomically("readers", ".reader.tmp-", {
        kind: "turn",
        info: { runId, environmentId: options.environmentId },
        created,
      }),
      (file) =>
        Effect.gen(function* () {
          // Register, then check: either we see the writer or its later listing sees us.
          let writer = yield* writerState();
          while (writer.state === "stale") {
            yield* clearStaleWriter(writer.owner);
            writer = yield* writerState();
          }
          if (writer.state !== "free") return writer.state === "held" ? "held" : "writer-unknown";
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => removeLockFile(file));
              transferred = true;
            }),
          );
          return "admitted" as const;
        }),
      (file) => (transferred ? Effect.void : removeLockFile(file)),
    );
  });

  const admitTurn: (typeof SkillsAdmission)["Service"]["admitTurn"] = Effect.fn(
    "SkillsAdmission.admitTurn",
  )(function* (input) {
    let notified = false;
    let warned = false;
    while (true) {
      const state = yield* tryAdmit(input.runId).pipe(
        Effect.catchTags({ PlatformError: () => Effect.succeed("filesystem" as const) }),
      );
      if (state === "admitted") return;
      if (!warned && state !== "held") {
        warned = true;
        yield* Effect.logWarning("Skills admission deferred", {
          runId: input.runId,
          reason: state,
        });
      }
      if (!notified) {
        notified = true;
        yield* input.onWait;
      }
      yield* waitForChange();
    }
  });

  return SkillsAdmission.of({ admitTurn });
});

export const make = Effect.fn("SkillsAdmission.make")(function* (options: AdmissionOptions) {
  const initialized = yield* Effect.result(makeReady(options));
  if (initialized._tag === "Success") return initialized.success;

  const reason = typeof initialized.failure === "string" ? initialized.failure : "filesystem";
  yield* Effect.logWarning("Skills admission unavailable; setup will retry", { reason });
  const ready = yield* Deferred.make<(typeof SkillsAdmission)["Service"]>();
  yield* Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(STALE_RECHECK);
      const recovered = yield* Effect.result(makeReady(options));
      if (recovered._tag === "Success") {
        yield* Deferred.succeed(ready, recovered.success);
        return;
      }
    }
  }).pipe(Effect.forkScoped);

  return SkillsAdmission.of({
    admitTurn: Effect.fn("SkillsAdmission.awaitSetup")(function* (input) {
      const current = yield* Deferred.poll(ready);
      if (Option.isSome(current)) {
        const service = yield* current.value;
        return yield* service.admitTurn(input);
      }
      yield* input.onWait;
      const service = yield* Deferred.await(ready);
      yield* service.admitTurn({ ...input, onWait: Effect.void });
    }),
  });
});

export const layer = Layer.effect(
  SkillsAdmission,
  Effect.gen(function* () {
    if (HostProcess.Platform.defaultValue() === "win32") return { admitTurn: admitWithoutLock };
    const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
    return yield* make({
      probe: yield* makeSystemProbe,
      environmentId: yield* identity.getEnvironmentId,
      serverVersion: packageJson.version,
    });
  }),
);
