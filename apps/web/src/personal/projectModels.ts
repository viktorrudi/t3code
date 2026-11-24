import { projectAllowsModelInstance } from "@t3tools/client-runtime/project-model-routing";
import type { ProviderInstanceEntry } from "../providerInstances";

export function projectModelInstances(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  projectTitle: string | null,
): ReadonlyArray<ProviderInstanceEntry> {
  return entries.filter((entry) => projectAllowsModelInstance(projectTitle, entry.instanceId));
}
