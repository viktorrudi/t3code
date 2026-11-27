import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { EnvironmentId, RunId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import { expect } from "vite-plus/test";

import * as SkillsAdmission from "./SkillsAdmission.ts";

const START = "Fri Nov 27 09:00:00 2026";
// Every pid is alive with START unless listed as dead.
const probe = (dead: ReadonlySet<number> = new Set()): SkillsAdmission.LockProbe => ({
  exists: (pid) => Effect.succeed(!dead.has(pid)),
  start: (pid) => Effect.succeed(dead.has(pid) ? null : START),
});

const setup = Effect.fn("SkillsAdmissionTest.setup")(function* (
  dead?: ReadonlySet<number>,
  serverScope?: Scope.Scope,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(yield* fileSystem.makeTempDirectoryScoped(), "common-lock");
  const create = SkillsAdmission.make({
    directory,
    probe: probe(dead),
    environmentId: EnvironmentId.make("environment-test"),
    serverVersion: "test",
  });
  const service = yield* serverScope === undefined
    ? create
    : create.pipe(Scope.provide(serverScope));
  const writer = (nonce: string, pid = 4242) =>
    fileSystem
      .makeDirectory(path.join(directory, "writer"), { recursive: true })
      .pipe(
        Effect.andThen(
          fileSystem.writeFileString(
            path.join(directory, "writer", `${nonce}.json`),
            JSON.stringify({ nonce, pid, start: START }),
          ),
        ),
      );
  const list = (sub: string) => fileSystem.readDirectory(path.join(directory, sub));
  return { fileSystem, path, directory, service, writer, list };
});

it.layer(Layer.merge(NodeServices.layer, SecureRandom.layerWebCrypto))("SkillsAdmission", (it) => {
  it.effect("registers a capability and holds a turn reader until the run scope closes", () =>
    Effect.gen(function* () {
      const { service, list } = yield* setup();
      expect(yield* list("capabilities")).toHaveLength(1);
      const runScope = yield* Scope.make();
      yield* service
        .admitTurn({ runId: RunId.make("run-1"), onWait: Effect.die("must not wait") })
        .pipe(Scope.provide(runScope));
      expect(yield* list("readers")).toHaveLength(1);
      yield* Scope.close(runScope, Exit.void);
      expect(yield* list("readers")).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("a held writer makes the turn wait visibly and admits it after release", () =>
    Effect.gen(function* () {
      const { service, writer, fileSystem, path, directory, list } = yield* setup();
      yield* writer("apply");
      const waiting = yield* Deferred.make<void>();
      const fiber = yield* service
        .admitTurn({ runId: RunId.make("run-2"), onWait: Deferred.succeed(waiting, undefined) })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(waiting);
      expect(yield* list("readers")).toEqual([]);
      yield* fileSystem.remove(path.join(directory, "writer", "apply.json"));
      yield* Fiber.join(fiber);
      expect(yield* list("readers")).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("a provably dead writer is cleared without waiting", () =>
    Effect.gen(function* () {
      const { service, writer, list } = yield* setup(new Set([4242]));
      yield* writer("crashed");
      yield* service.admitTurn({ runId: RunId.make("run-3"), onWait: Effect.die("must not wait") });
      expect(yield* list("writer")).toEqual([]);
      expect(yield* list("readers")).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("an unknown protocol version waits instead of admitting", () =>
    Effect.gen(function* () {
      const { service, fileSystem, path, directory, list } = yield* setup();
      yield* fileSystem.writeFileString(path.join(directory, "protocol.json"), '{"version":2}');
      const waiting = yield* Deferred.make<void>();
      const fiber = yield* service
        .admitTurn({ runId: RunId.make("run-4"), onWait: Deferred.succeed(waiting, undefined) })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(waiting);
      expect(yield* list("readers")).toEqual([]);
      yield* fileSystem.writeFileString(path.join(directory, "protocol.json"), '{"version":1}');
      yield* Fiber.join(fiber);
      expect(yield* list("readers")).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("the capability is removed when the server scope closes", () =>
    Effect.gen(function* () {
      const serverScope = yield* Scope.make();
      const { list } = yield* setup(undefined, serverScope);
      expect(yield* list("capabilities")).toHaveLength(1);
      yield* Scope.close(serverScope, Exit.void);
      expect(yield* list("capabilities")).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("does not leak a reader when interrupted during registration", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const registered = yield* Deferred.make<void>();
      const finishRename = yield* Deferred.make<void>();
      const { service, list } = yield* setup().pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          rename: (from, to) =>
            fileSystem
              .rename(from, to)
              .pipe(
                Effect.andThen(
                  to.includes("/readers/")
                    ? Deferred.succeed(registered, undefined).pipe(
                        Effect.andThen(Deferred.await(finishRename)),
                      )
                    : Effect.void,
                ),
              ),
        }),
      );
      const fiber = yield* service
        .admitTurn({ runId: RunId.make("run-interrupted"), onWait: Effect.void })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(registered);
      yield* Fiber.interrupt(fiber).pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.succeed(finishRename, undefined);
      yield* Fiber.await(fiber);
      expect(yield* list("readers")).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
