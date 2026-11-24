import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

/** Written by an external script to `<state dir>/thread-annotations.json`; T3 only displays it. */
export const SENSONEO_JIRA_HOST = "sensoneosk.atlassian.net";

export const THREAD_ANNOTATIONS_FILE = "thread-annotations.json";

export const ThreadTicketDeployTone = Schema.Literals(["success", "info", "warning", "muted"]);
export type ThreadTicketDeployTone = typeof ThreadTicketDeployTone.Type;

/** A deploy target; `none` means the release is deliberately not meant to reach any environment. */
export const DeployTargetEnv = Schema.Literals(["DEV", "QA", "UAT", "PROD", "none"]);
export type DeployTargetEnv = typeof DeployTargetEnv.Type;

/**
 * The release whose target the badge shows. The picker edits this exact release rather than the
 * ticket, because a target belongs to the release: every ticket on it follows the same one.
 */
export const ThreadTicketDeployTarget = Schema.Struct({
  project: Schema.String.check(Schema.isMaxLength(16)),
  release: Schema.String.check(Schema.isMaxLength(32)),
  env: DeployTargetEnv,
});
export type ThreadTicketDeployTarget = typeof ThreadTicketDeployTarget.Type;

/** A release the ticket could move to, with the env that release targets and the furthest it reached. */
export const ThreadTicketReleaseChoice = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(32)),
  env: DeployTargetEnv,
  reached: Schema.optional(Schema.String.check(Schema.isMaxLength(8))),
  /** No release branch yet; assigning still works, the branch is cut later. */
  uncut: Schema.optional(Schema.Boolean),
});
export type ThreadTicketReleaseChoice = typeof ThreadTicketReleaseChoice.Type;

export const ThreadTicketReleaseAssignment = Schema.Struct({
  project: Schema.String.check(Schema.isMaxLength(16)),
  current: Schema.optional(Schema.String.check(Schema.isMaxLength(32))),
  choices: Schema.Array(ThreadTicketReleaseChoice).check(Schema.isMaxLength(12)),
});
export type ThreadTicketReleaseAssignment = typeof ThreadTicketReleaseAssignment.Type;

export const ThreadTicketDeploy = Schema.Struct({
  label: Schema.String.check(Schema.isMaxLength(40)),
  tone: ThreadTicketDeployTone,
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  /** Absent when the ticket sits on no release, so there is nothing to point anywhere. */
  target: Schema.optional(ThreadTicketDeployTarget),
  assign: Schema.optional(ThreadTicketReleaseAssignment),
});
export type ThreadTicketDeploy = typeof ThreadTicketDeploy.Type;

export const JiraIssueKey = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,15}-\d{1,9}$/u));

export const JiraTicketLinkInput = Schema.Struct({
  threadId: ThreadId,
  key: JiraIssueKey,
  linked: Schema.Boolean,
});
export type JiraTicketLinkInput = typeof JiraTicketLinkInput.Type;

export const JiraWorkPullRequest = Schema.Struct({
  url: Schema.String,
  number: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
});
export type JiraWorkPullRequest = typeof JiraWorkPullRequest.Type;

export const JiraTicketWork = Schema.Struct({
  release: Schema.NullOr(Schema.String),
  deploy: Schema.optional(ThreadTicketDeploy),
  fixVersions: Schema.Array(Schema.String),
  linkedChatCount: Schema.Number,
  pullRequests: Schema.Array(JiraWorkPullRequest),
});
export type JiraTicketWork = typeof JiraTicketWork.Type;

export const ThreadTicket = Schema.Struct({
  key: JiraIssueKey,
  flag: Schema.optional(Schema.String.check(Schema.isMaxLength(16))),
  url: Schema.String.check(Schema.isMaxLength(2_000)),
  deploy: Schema.optional(ThreadTicketDeploy),
});
export type ThreadTicket = typeof ThreadTicket.Type;

export const ThreadTicketAnnotations = Schema.Struct({
  /** Keyed by thread id. */
  threads: Schema.Record(Schema.String, Schema.Array(ThreadTicket)),
});
export type ThreadTicketAnnotations = typeof ThreadTicketAnnotations.Type;

export const JiraIssueInput = Schema.Struct({ key: JiraIssueKey });
export type JiraIssueInput = typeof JiraIssueInput.Type;

export const JiraIssueStatusCategory = Schema.Literals(["new", "indeterminate", "done", "unknown"]);
export type JiraIssueStatusCategory = typeof JiraIssueStatusCategory.Type;

export const JiraIssueTransition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  toStatus: Schema.String,
  toCategory: JiraIssueStatusCategory,
});
export type JiraIssueTransition = typeof JiraIssueTransition.Type;

export const JiraIssueDetails = Schema.Struct({
  key: JiraIssueKey,
  url: Schema.String,
  summary: Schema.String,
  issueType: Schema.NullOr(Schema.String),
  status: Schema.Struct({ name: Schema.String, category: JiraIssueStatusCategory }),
  assignee: Schema.NullOr(
    Schema.Struct({ displayName: Schema.String, avatarUrl: Schema.NullOr(Schema.String) }),
  ),
  transitions: Schema.Array(JiraIssueTransition),
});
export type JiraIssueDetails = typeof JiraIssueDetails.Type;

export const JiraIssueTransitionInput = Schema.Struct({
  key: JiraIssueKey,
  transitionId: Schema.String.check(Schema.isPattern(/^\d{1,9}$/u)),
});
export type JiraIssueTransitionInput = typeof JiraIssueTransitionInput.Type;

export const DeployTargetInput = Schema.Struct({
  project: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,15}$/u)),
  release: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9](?:[\w.-]{0,30})$/u)),
  env: DeployTargetEnv,
});
export type DeployTargetInput = typeof DeployTargetInput.Type;

export const ReleaseAssignInput = Schema.Struct({
  key: JiraIssueKey,
  release: Schema.String.check(Schema.isPattern(/^(?:none|\d{1,4}(?:\.\d{1,4})?)$/u)),
});
export type ReleaseAssignInput = typeof ReleaseAssignInput.Type;

export class DeployTargetError extends Schema.TaggedError<DeployTargetError>()(
  "DeployTargetError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class JiraIssueError extends Schema.TaggedError<JiraIssueError>()("JiraIssueError", {
  key: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
