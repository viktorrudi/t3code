import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { TextGenerationError } from "./git.ts";

/** Sidebar thread groups live on the client; only their titles need a provider. */
export const ThreadGroupTitleInput = Schema.Struct({
  /** Picks the cwd, title instructions, and text generation model. */
  projectId: ProjectId,
  threadTitles: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(500))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});
export type ThreadGroupTitleInput = typeof ThreadGroupTitleInput.Type;

export const ThreadGroupTitleResult = Schema.Struct({ title: Schema.String });
export type ThreadGroupTitleResult = typeof ThreadGroupTitleResult.Type;

export class ThreadGroupTitleError extends Schema.TaggedError<ThreadGroupTitleError>()(
  "ThreadGroupTitleError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Union([TextGenerationError, Schema.Defect()])),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
