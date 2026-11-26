import { detectComposerTrigger, type ComposerTrigger } from "@t3tools/shared/composerTrigger";
import type { ComposerEnvironmentCandidate } from "@t3tools/client-runtime/composerThreadItems";

export type MobileComposerTrigger = Omit<ComposerTrigger, "kind"> & {
  kind: ComposerTrigger["kind"] | "environment";
};

export function detectMobileComposerTrigger(
  text: string,
  cursor: number,
  personalFork: boolean,
): MobileComposerTrigger | null {
  const trigger = detectComposerTrigger(text, cursor);
  return personalFork && trigger?.kind === "pull-request"
    ? { ...trigger, kind: "environment" }
    : trigger;
}

export function mobileEnvironmentItems(
  environments: readonly ComposerEnvironmentCandidate[],
  query: string,
) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return environments
    .filter((environment) =>
      words.every((word) =>
        `${environment.label} ${environment.environmentId}`.toLowerCase().includes(word),
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((environment) => ({
      ...environment,
      id: `environment:${environment.environmentId}`,
      type: "environment" as const,
      description: "",
    }));
}
