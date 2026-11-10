import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { splitPromptIntoComposerSegments } from "../composer-editor-mentions";
import {
  modelMentionMatches,
  modelMentionKey,
  modelMentionHref,
  parseModelMentionHref,
  parseModelMentionSource,
  serializeModelMention,
  type ModelMention,
} from "./modelMentions";

const mention: ModelMention = {
  instanceId: ProviderInstanceId.make("claude-sensoneo"),
  driverKind: ProviderDriverKind.make("claudeAgent"),
  providerName: "Claude Sensoneo",
  name: "Claude Opus 5.5",
  model: "claude-opus-5-5",
};

function provider(id: string, names: string[], enabled = true): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: id,
    enabled,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: names.map((name) => ({ slug: name, name, isCustom: false, capabilities: {} })),
    skills: [],
    slashCommands: [],
  };
}

const entries = deriveProviderInstanceEntries([
  provider("claudeAgent", ["opus-5.5", "sonnet-5.5", "haiku-5.5"]),
  provider("codex", ["gpt-5.5"]),
  provider("claude-sensoneo", ["work-opus-5.5"]),
  provider("litellm-sensoneo", ["blaze"]),
  { ...provider("cursor", ["grok-4.7"]), driver: ProviderDriverKind.make("cursor") },
  provider("disabled", ["disabled-5.5"], false),
]);
const modelOptions = new Map(
  entries.map((entry) => [
    entry.instanceId,
    getAppModelOptionsForInstance(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        providerModelPreferences: {
          [ProviderInstanceId.make("claudeAgent")]: {
            modelOrder: ["sonnet-5.5", "opus-5.5"],
            hiddenModels: ["haiku-5.5"],
          },
        },
      },
      entry,
    ),
  ]),
);
const input = { entries, modelOptions, projectTitle: null, query: "", recentKeys: [] };

describe("model mentions", () => {
  it("filters the enabled catalog by project and keeps configured model order when searching", () => {
    expect(modelMentionMatches({ ...input, query: "5.5" }).map((model) => model.model)).toEqual([
      "sonnet-5.5",
      "opus-5.5",
      "gpt-5.5",
    ]);
    expect(
      modelMentionMatches({ ...input, projectTitle: " Sensoneo Frontend " }).map(
        (model) => model.instanceId,
      ),
    ).toEqual(["claude-sensoneo", "litellm-sensoneo", "cursor"]);
    for (const projectTitle of ["Sensoneo", " sensoneo ", "SENSONEO"]) {
      expect(
        modelMentionMatches({ ...input, projectTitle }).map((model) => model.instanceId),
      ).toEqual(["claude-sensoneo", "litellm-sensoneo", "cursor"]);
      expect(
        modelMentionMatches({ ...input, projectTitle, query: "cursor grok" }).map((model) => [
          model.instanceId,
          model.driverKind,
          model.model,
        ]),
      ).toEqual([["cursor", "cursor", "grok-4.7"]]);
      expect(
        modelMentionMatches({ ...input, projectTitle, query: "litellm blaze" }).map(
          (model) => model.model,
        ),
      ).toEqual(["blaze"]);
    }
    expect(modelMentionMatches({ ...input, query: "litellm" })).toEqual([]);
    for (const projectTitle of [null, "Personal", "Sensoneo archive"]) {
      expect(modelMentionMatches({ ...input, projectTitle, query: "cursor" })).toEqual([]);
    }
    expect(
      modelMentionMatches({
        ...input,
        projectTitle: "Sensoneo Frontend",
        query: "litellm blaze",
      }).map((model) => model.model),
    ).toEqual(["blaze"]);
  });

  it("promotes the most recent eligible reference only on an empty query", () => {
    const recentKeys = [
      modelMentionKey(mention),
      modelMentionKey({ instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" }),
    ];
    expect(modelMentionMatches({ ...input, recentKeys })[0]?.model).toBe("gpt-5.5");
    expect(modelMentionMatches({ ...input, recentKeys, query: "5.5" })[0]?.model).toBe(
      "sonnet-5.5",
    );
    expect(
      modelMentionMatches({ ...input, recentKeys, projectTitle: "Sensoneo" })[0]?.instanceId,
    ).toBe("claude-sensoneo");
  });

  it("roundtrips exact IDs and markdown punctuation into an atomic restored chip alongside files and skills", () => {
    const model = { ...mention, name: "Model [5.5] \\ test", model: "org/model (v5)?x=1&y=2" };
    expect(parseModelMentionHref(modelMentionHref(model))).toEqual(model);
    const source = serializeModelMention(model);
    expect(parseModelMentionSource(source)).toEqual(model);
    expect(source).toContain("provider=claude-sensoneo&model=org%2Fmodel");
    expect(splitPromptIntoComposerSegments(`Use ${source} with @AGENTS.md and $review `)).toEqual([
      { type: "text", text: "Use " },
      {
        type: "context-reference",
        kind: "model",
        contextId: modelMentionKey(model),
        label: model.name,
        source,
      },
      { type: "text", text: " with " },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " and " },
      { type: "skill", name: "review", source: "$review" },
      { type: "text", text: " " },
    ]);
    expect(parseModelMentionHref("t3-model://reference?provider=claude-sensoneo")).toBeNull();
    expect(parseModelMentionHref("https://example.com/")).toBeNull();
  });
});
