/* oxlint-disable t3code/no-untranslated-copy -- Release channel names are fixed branding, shared with the app icons. */
export type MobileStageLabel = "Beta" | "Dev" | "Nightly";

export function resolveMobileStageLabel(
  appVariant: unknown,
  personalFork = false,
): MobileStageLabel | null {
  if (personalFork) return null;
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Beta";
}
