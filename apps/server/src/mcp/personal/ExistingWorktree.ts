// @effect-diagnostics nodeBuiltinImport:off -- Pure path checks must match the host Git implementation.
import * as NodePath from "node:path";
import { WorktreeMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";

export const resolveExistingWorktree = Effect.fn("ExistingWorktree.resolve")(function* (input: {
  readonly path: string;
  readonly branch: string;
  readonly projectRoots: ReadonlyArray<string>;
  readonly isManagedWorktreePath: (path: string) => Effect.Effect<boolean>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const invalid = () =>
    new WorktreeMcpFailure({
      code: "invalid_request",
      message:
        "Use the root of an existing linked Git worktree of this thread's project, on the recorded branch. The worktree was not changed.",
    });
  if (!NodePath.isAbsolute(input.path)) return yield* invalid();
  const worktreePath = yield* fs.realPath(input.path).pipe(Effect.mapError(invalid));
  const gitEntry = yield* fs
    .stat(NodePath.join(worktreePath, ".git"))
    .pipe(Effect.mapError(invalid));
  if (gitEntry.type !== "File") return yield* invalid();
  // T3's own handoff checkouts (`t3/` branches) are not task or ticket worktrees.
  if (yield* input.isManagedWorktreePath(worktreePath)) {
    return yield* new WorktreeMcpFailure({
      code: "invalid_request",
      message:
        "This is a T3-managed checkout, not a task or ticket worktree. Attach only the worktree the task or ticket skill created under its worktrees root, and record that one instead. The worktree was not changed.",
    });
  }
  const status = yield* git.localStatus({ cwd: worktreePath }).pipe(Effect.mapError(invalid));
  if (!status.isRepo || status.refName !== input.branch) return yield* invalid();

  for (const cwd of input.projectRoots) {
    let cursor: number | undefined;
    do {
      const refs = yield* git
        .listRefs({
          cwd,
          query: input.branch,
          refKind: "local",
          refresh: true,
          ...(cursor === undefined ? {} : { cursor }),
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (refs === null) break;
      const ref = refs.refs.find((ref) => ref.name === input.branch && ref.isRemote !== true);
      if (ref?.worktreePath != null) {
        const registeredPath = yield* fs
          .realPath(ref.worktreePath)
          .pipe(Effect.orElseSucceed(() => null));
        if (registeredPath === worktreePath) return { worktreePath, branch: input.branch };
      }
      cursor = refs.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
  return yield* invalid();
});
