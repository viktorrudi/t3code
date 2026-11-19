import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  type ThreadGroupTitleError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as ProjectStore from "../ProjectStore.ts";
import * as ThreadGroupTitles from "./ThreadGroupTitles.ts";

const projectId = ProjectId.make("project:groups");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" };

function makeLayer(
  generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"],
) {
  const project = {
    projectId,
    title: "Project",
    workspaceRoot: "/repo",
    defaultModelSelection: modelSelection,
    defaultThreadEnvMode: null,
    hasCustomTitle: false,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    pinnedAt: null,
    archivedAt: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  return ThreadGroupTitles.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (requested) =>
            Effect.succeed(requested === projectId ? Option.some(project) : Option.none()),
        }),
        Layer.mock(TextGeneration.TextGeneration)({ generateThreadTitle }),
        ServerSettings.layerTest({
          threadTitleInstructions: "Use sentence case.",
          textGenerationModelSelection: modelSelection,
        }),
        NodeServices.layer,
      ),
    ),
  );
}

describe("ThreadGroupTitles", () => {
  it.effect("titles a group from its member titles with the project's title settings", () => {
    const generateThreadTitle = vi.fn<
      TextGeneration.TextGeneration["Service"]["generateThreadTitle"]
    >(() => Effect.succeed({ title: " Login work " }));
    return Effect.gen(function* () {
      const titles = yield* ThreadGroupTitles.ThreadGroupTitles;
      const result = yield* titles.generate({
        projectId,
        threadTitles: ["Fix login", "Add OAuth"],
      });
      assert.deepStrictEqual(result, { title: "Login work" });
      const input = generateThreadTitle.mock.calls[0]![0];
      assert.strictEqual(
        input.message,
        ThreadGroupTitles.threadGroupTitleMessage(["Fix login", "Add OAuth"]),
      );
      assert.strictEqual(input.projectTitle, "Project");
      assert.strictEqual(input.instructions, "Use sentence case.");
      assert.strictEqual(input.modelSelection.instanceId, modelSelection.instanceId);
      assert.strictEqual(input.modelSelection.model, modelSelection.model);
      assert.notStrictEqual(input.cwd, "/repo");
    }).pipe(Effect.provide(makeLayer(generateThreadTitle)));
  });

  it.effect("reports a missing project and a provider failure as group title errors", () => {
    const generateThreadTitle = () =>
      Effect.fail(
        new TextGenerationError({ operation: "generateThreadTitle", detail: "Quota exhausted" }),
      );
    return Effect.gen(function* () {
      const titles = yield* ThreadGroupTitles.ThreadGroupTitles;
      const failed = (error: ThreadGroupTitleError) => error.detail;
      assert.strictEqual(
        yield* titles
          .generate({ projectId: ProjectId.make("gone"), threadTitles: ["A"] })
          .pipe(Effect.flip, Effect.map(failed)),
        "The group's project no longer exists.",
      );
      assert.strictEqual(
        yield* titles
          .generate({ projectId, threadTitles: ["A"] })
          .pipe(Effect.flip, Effect.map(failed)),
        "Quota exhausted",
      );
    }).pipe(Effect.provide(makeLayer(generateThreadTitle)));
  });
});
