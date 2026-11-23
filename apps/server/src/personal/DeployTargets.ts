import {
  DeployTargetError,
  type DeployTargetInput,
  type ReleaseAssignInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * The release target lives in the Sensoneo ticket skill's own `targets.json`, written by its
 * `deploy-status.mjs target` command. This runs that command instead of rewriting the file here, so
 * one writer validates it, and the skill's daemon renders the annotation the sidebar reads.
 */
export class DeployTargets extends Context.Service<
  DeployTargets,
  {
    readonly set: (input: DeployTargetInput) => Effect.Effect<void, DeployTargetError>;
    /** Moves one ticket to another release (or to none) through `deploy-status.mjs assign`. */
    readonly assign: (input: ReleaseAssignInput) => Effect.Effect<void, DeployTargetError>;
  }
>()("t3/personal/DeployTargets") {}

const DEPLOY_STATUS = "/Users/viktorrudi/.claude/skills/ticket/scripts/deploy-status.mjs";
const SKILL_ROOT = "/Users/viktorrudi/Documents/Repositories/sensoneo";

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run = Effect.fn("DeployTargets.run")(function* (args: ReadonlyArray<string>) {
    const command = ChildProcess.make("/usr/bin/env", ["node", DEPLOY_STATUS, ...args], {
      cwd: SKILL_ROOT,
      stdin: "ignore",
      stderr: "pipe",
    });
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command).pipe(
          Effect.mapError(
            (cause) =>
              new DeployTargetError({
                detail: "Could not start the deploy-status command.",
                cause,
              }),
          ),
        );
        const output = yield* Stream.runFold(
          handle.all,
          () => "",
          (text, chunk) => text + new TextDecoder().decode(chunk),
        ).pipe(Effect.orElseSucceed(() => ""));
        const code = yield* handle.exitCode.pipe(
          Effect.mapError(
            (cause) => new DeployTargetError({ detail: "deploy-status did not finish.", cause }),
          ),
        );
        if (Number(code) === 0) return;
        return yield* new DeployTargetError({
          detail: `deploy-status ${args[0]} exited ${Number(code)}: ${output.trim().slice(-500)}`,
        });
      }),
    );
  });

  const set = (input: DeployTargetInput) =>
    run(["target", input.project, input.release, input.env]);
  const assign = (input: ReleaseAssignInput) => run(["assign", input.key, input.release]);

  return DeployTargets.of({ set, assign });
});

export const layer = Layer.effect(DeployTargets, make);
