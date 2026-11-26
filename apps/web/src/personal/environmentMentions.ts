import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { detectComposerPullRequestTrigger } from "@t3tools/shared/composerTrigger";

export function detectEnvironmentMentionTrigger(token: string, cursor: number) {
  const trigger = detectComposerPullRequestTrigger(token, cursor);
  return trigger ? { ...trigger, kind: "environment" as const } : null;
}

export function rememberEnvironmentMention(recents: readonly string[], environmentId: string) {
  return [...new Set([environmentId, ...recents])].slice(0, 30);
}

export function environmentMentionMatches(input: {
  environments: ReadonlyArray<{
    environmentId: EnvironmentId;
    label: string;
    machine: EnvironmentMachineKind;
  }>;
  query: string;
  recentIds: readonly string[];
}) {
  const words = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rank = new Map(input.recentIds.map((id, index) => [id, index]));
  return input.environments
    .filter((environment) => {
      const haystack = `${environment.label} ${environment.environmentId}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .toSorted(
      (a, b) =>
        (rank.get(a.environmentId) ?? Infinity) - (rank.get(b.environmentId) ?? Infinity) ||
        a.label.localeCompare(b.label),
    );
}
