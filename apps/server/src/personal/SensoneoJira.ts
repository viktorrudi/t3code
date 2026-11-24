import * as NodeOS from "node:os";
import {
  IssueTrackerKind,
  SENSONEO_JIRA_HOST,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";

export const JIRA_TRACKER = IssueTrackerKind.make("jira");
export const JIRA_HOST = SENSONEO_JIRA_HOST;
export const JIRA_PROJECTS = ["RET", "GRE", "DRSI", "FED"] as const;

export const ticketRoot = () =>
  (process.env.TICKET_ROOT || `${NodeOS.homedir()}/Documents/Repositories/sensoneo`).replace(
    /\/+$/u,
    "",
  );

export function jiraScopes(project: Pick<OrchestrationProjectShell, "workspaceRoot">) {
  const root = ticketRoot();
  const workspace = project.workspaceRoot.replace(/\/+$/u, "");
  if (workspace === `${root}/frontend`) return JIRA_PROJECTS;
  if (workspace === `${root}/test-composer/test-composer`) return ["FED"] as const;
  return [];
}

export function jiraProject(key: string) {
  const match = /^(RET|GRE|DRSI|FED)-\d{1,9}$/u.exec(key);
  return JIRA_PROJECTS.find((project) => project === match?.[1]);
}
