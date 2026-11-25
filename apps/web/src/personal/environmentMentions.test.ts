import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { environmentMentionMatches, rememberEnvironmentMention } from "./environmentMentions";
import {
  environmentContextRecord,
  environmentContextReference,
  buildMessageContext,
} from "../lib/composerContextRecords";
import { formatInlineContextReference } from "../lib/composerContextReferences";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

const environments = [
  { environmentId: EnvironmentId.make("local"), label: "This Mac", machine: "laptop" as const },
  { environmentId: EnvironmentId.make("intel"), label: "Agents Mac", machine: "laptop" as const },
  { environmentId: EnvironmentId.make("pc"), label: "Agents PC", machine: "server" as const },
];

describe("environment mentions", () => {
  it("offers all known machines on bare # and ranks matching recents by stable identity", () => {
    const matches = (query: string, recentIds: string[] = []) =>
      environmentMentionMatches({ environments, query, recentIds });
    expect(matches("").map((x) => x.label)).toEqual(["Agents Mac", "Agents PC", "This Mac"]);
    expect(matches("", ["removed", "pc", "intel"]).map((x) => x.environmentId)).toEqual([
      "pc",
      "intel",
      "local",
    ]);
    expect(matches("MAC", ["local"]).map((x) => x.environmentId)).toEqual(["local", "intel"]);
    expect(matches("intel").map((x) => x.label)).toEqual(["Agents Mac"]);
    expect(matches("missing")).toEqual([]);
    expect(environments[0]!.environmentId).toBe("local");
  });

  it("moves a repeated selection to the top and bounds saved recents", () => {
    expect(rememberEnvironmentMention(["intel", "pc", "pc"], "pc")).toEqual(["pc", "intel"]);
    expect(
      rememberEnvironmentMention(
        Array.from({ length: 40 }, (_, i) => String(i)),
        "new",
      ),
    ).toHaveLength(30);
  });

  it("carries a selected machine through the composer record into agent-readable context", () => {
    const selected = environmentMentionMatches({ environments, query: "intel", recentIds: [] })[0]!;
    const record = environmentContextRecord(selected.environmentId, selected.label);
    const text = `Check ${formatInlineContextReference(environmentContextReference(record))}`;
    const context = buildMessageContext({
      environmentContexts: [record],
      terminalContexts: [],
      reviewComments: [],
      previewAnnotations: [],
    });
    const projected = projectComposerContextForProvider({ text, records: context!.records });
    expect(projected).toContain("label: Agents Mac");
    expect(projected).toContain("environmentId: intel");
    expect(projected).toContain("The user means this machine");
    expect(projected).not.toContain("https:");
  });
});
