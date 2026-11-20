import * as Schema from "effect/Schema";

/** Written by an external script to `<state dir>/thread-annotations.json`; T3 only displays it. */
export const THREAD_ANNOTATIONS_FILE = "thread-annotations.json";

export const ThreadTicketDeployTone = Schema.Literals(["success", "info", "warning", "muted"]);
export type ThreadTicketDeployTone = typeof ThreadTicketDeployTone.Type;

export const ThreadTicketDeploy = Schema.Struct({
  label: Schema.String.check(Schema.isMaxLength(40)),
  tone: ThreadTicketDeployTone,
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type ThreadTicketDeploy = typeof ThreadTicketDeploy.Type;

export const JiraIssueKey = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,15}-\d{1,9}$/u));

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

export class JiraIssueError extends Schema.TaggedError<JiraIssueError>()("JiraIssueError", {
  key: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
