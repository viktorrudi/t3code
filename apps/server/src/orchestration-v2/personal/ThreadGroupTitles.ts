import {
  ThreadGroupTitleError,
  type ThreadGroupTitleInput,
  type ThreadGroupTitleResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as ProjectStore from "../ProjectStore.ts";

/** Names a sidebar thread group with the project's thread title model and instructions. */
export class ThreadGroupTitles extends Context.Service<
  ThreadGroupTitles,
  {
    readonly generate: (
      input: ThreadGroupTitleInput,
    ) => Effect.Effect<ThreadGroupTitleResult, ThreadGroupTitleError>;
  }
>()("t3/orchestration-v2/personal/ThreadGroupTitles") {}

const isThreadGroupTitleError = Schema.is(ThreadGroupTitleError);

export function threadGroupTitleMessage(threadTitles: ReadonlyArray<string>): string {
  return [
    "These threads were grouped together. Write one short title naming what they share.",
    "",
    ...threadTitles.map((title) => `- ${title}`),
  ].join("\n");
}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;

  const generate = Effect.fn("ThreadGroupTitles.generate")(
    function* (input: ThreadGroupTitleInput) {
      const project = yield* projects.get(input.projectId);
      if (Option.isNone(project)) {
        return yield* new ThreadGroupTitleError({
          detail: "The group's project no longer exists.",
        });
      }
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        input.projectId,
      ).settings;
      // The title comes from thread titles alone, so the provider never needs the checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-thread-group-title-" });
      const result = yield* textGeneration.generateThreadTitle({
        cwd,
        message: threadGroupTitleMessage(input.threadTitles),
        projectTitle: project.value.title,
        attachments: [],
        instructions: settings.threadTitleInstructions,
        modelSelection: settings.textGenerationModelSelection,
        projectId: input.projectId,
      });
      const title = result.title.trim();
      if (title.length === 0 || title === "New thread") {
        return yield* new ThreadGroupTitleError({ detail: "No group title was generated." });
      }
      return { title };
    },
    Effect.scoped,
    Effect.catchTags({
      TextGenerationError: (cause) =>
        Effect.fail(new ThreadGroupTitleError({ detail: cause.detail, cause })),
    }),
    Effect.mapError((cause) =>
      isThreadGroupTitleError(cause)
        ? cause
        : new ThreadGroupTitleError({ detail: "Group title generation failed.", cause }),
    ),
  );

  return ThreadGroupTitles.of({ generate });
});

export const layer = Layer.effect(ThreadGroupTitles, make);
