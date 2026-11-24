const workProjectTitles = new Set(["sensoneo", "sensoneo frontend"]);
const workInstanceIds = new Set(["claude-sensoneo", "litellm-sensoneo", "cursor"]);

export function projectAllowsModelInstance(projectTitle: string | null, instanceId: string) {
  const isWorkProject = workProjectTitles.has(projectTitle?.trim().toLowerCase() ?? "");
  return workInstanceIds.has(instanceId) === isWorkProject;
}

export function hasProjectModelRouting(instances: ReadonlyArray<{ readonly instanceId: string }>) {
  return instances.some(
    ({ instanceId }) => instanceId === "claude-sensoneo" || instanceId === "litellm-sensoneo",
  );
}
