import * as Schema from "effect/Schema";
import { ThreadPullRequestKey } from "./threadPullRequest.ts";

export const ThreadSnoozeCondition = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pull-request"), pullRequest: ThreadPullRequestKey }),
  Schema.Struct({
    kind: Schema.Literal("jira"),
    issueKey: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/)),
  }),
]);
export type ThreadSnoozeCondition = typeof ThreadSnoozeCondition.Type;

export type ThreadSnoozeChoice =
  | { readonly snoozedUntil: string; readonly snoozeCondition?: never }
  | { readonly snoozedUntil?: never; readonly snoozeCondition: ThreadSnoozeCondition };

export const EventSnoozeRules = Schema.Struct({
  pullRequestProjects: Schema.Array(Schema.String),
  jiraProjects: Schema.Array(Schema.String),
});
export type EventSnoozeRules = typeof EventSnoozeRules.Type;
export const DEFAULT_EVENT_SNOOZE_RULES: EventSnoozeRules = {
  pullRequestProjects: ["Sensoneo"],
  jiraProjects: ["Sensoneo"],
};

export function eventSnoozeAllowed(
  rules: EventSnoozeRules,
  project: { readonly id?: string; readonly projectId?: string; readonly title: string },
  kind: ThreadSnoozeCondition["kind"],
): boolean {
  const projects = kind === "jira" ? rules.jiraProjects : rules.pullRequestProjects;
  return projects.some(
    (value) =>
      value === (project.id ?? project.projectId) ||
      value.trim().toLowerCase() === project.title.trim().toLowerCase(),
  );
}

export function eventSnoozeLabel(condition: ThreadSnoozeCondition): string {
  return condition.kind === "jira"
    ? `Jira · ${condition.issueKey}`
    : `PR review · #${condition.pullRequest.number}`;
}
