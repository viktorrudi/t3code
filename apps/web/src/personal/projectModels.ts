import type { ProviderInstanceEntry } from "../providerInstances";

const SENSONEO_PROJECT_TITLES = new Set(["sensoneo", "sensoneo frontend"]);
const SENSONEO_INSTANCES = new Set(["claude-sensoneo", "litellm-sensoneo", "cursor"]);

export function projectModelInstances(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  projectTitle: string | null,
): ReadonlyArray<ProviderInstanceEntry> {
  const sensoneo = SENSONEO_PROJECT_TITLES.has(projectTitle?.trim().toLowerCase() ?? "");
  return entries.filter((entry) => SENSONEO_INSTANCES.has(entry.instanceId) === sensoneo);
}
