import { JiraIssueKey, type IssueActor, type IssueState } from "@t3tools/contracts";
import {
  IssueTrackerError,
  type IssueTrackerApi,
  type TrackerIssueSummary,
} from "@t3tools/source-control-core/server/IssueTracker";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClientRequest } from "effect/http";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as JiraClient from "./JiraClient.ts";
import { jiraDocument } from "./jiraDocument.ts";
import { JIRA_DETAIL_FIELDS, jiraIssueContent } from "./jiraIssueContent.ts";
import { httpsBrowserUrl, loadTicketWork } from "./JiraTicketWork.ts";
import { JIRA_HOST, JIRA_PROJECTS, JIRA_TRACKER, jiraProject } from "./SensoneoJira.ts";

const JiraTimestamp = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value))),
);
const Person = Schema.Struct({
  accountId: Schema.NonEmptyString,
  displayName: Schema.optional(Schema.String),
  avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const JiraIssue = Schema.Struct({
  key: JiraIssueKey,
  fields: Schema.Struct({
    summary: Schema.NonEmptyString,
    created: JiraTimestamp,
    updated: JiraTimestamp,
    resolutiondate: Schema.optional(Schema.NullOr(JiraTimestamp)),
    status: Schema.Struct({
      name: Schema.NonEmptyString,
      statusCategory: Schema.Struct({ key: Schema.String }),
    }),
    assignee: Schema.optional(Schema.NullOr(Person)),
    creator: Schema.optional(Schema.NullOr(Person)),
    labels: Schema.optional(Schema.Array(Schema.NonEmptyString)),
    fixVersions: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  }),
});
const decodeIssue = Schema.decodeUnknownEffect(JiraIssue);
const JiraPage = Schema.Struct({
  issues: Schema.Array(JiraIssue),
  nextPageToken: Schema.optional(Schema.NullOr(Schema.String)),
  isLast: Schema.optional(Schema.Boolean),
});
const CommentPage = Schema.Struct({
  startAt: Schema.Number,
  total: Schema.Number,
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      author: Schema.optional(Schema.NullOr(Person)),
      body: Schema.Unknown,
      created: JiraTimestamp,
    }),
  ),
});

const fields = "summary,created,updated,resolutiondate,status,assignee,creator,labels,fixVersions";
const quote = (value: string) => JSON.stringify(value);
const issueKey = (query: string) => /^(RET|GRE|DRSI|FED)-?(\d{1,9})$/iu.exec(query);

export function jiraListQuery(input: Parameters<IssueTrackerApi["listIssues"]>[0]) {
  const scope = JIRA_PROJECTS.find((project) => project === input.scope.toUpperCase());
  if (!scope) return null;
  const query = input.query?.trim() ?? "";
  const key = issueKey(query);
  const projectFilter = JIRA_PROJECTS.find((project) => query.toUpperCase() === project);
  if ((key && key[1]?.toUpperCase() !== scope) || (projectFilter && projectFilter !== scope))
    return null;
  const parts = [`project = ${quote(scope)}`];
  if (input.state !== "all")
    parts.push(`statusCategory ${input.state === "closed" ? "=" : "!="} Done`);
  if (input.involvement === "assigned") parts.push("assignee = currentUser()");
  if (input.involvement === "authored") parts.push("creator = currentUser()");
  if (input.involvement === "mentioned") return null;
  if (input.assignee) parts.push(`assignee = ${quote(input.assignee)}`);
  for (const label of input.labels ?? []) parts.push(`labels = ${quote(label)}`);
  if (key) parts.push(`key = ${quote(`${scope}-${key[2]}`)}`);
  else if (query && !projectFilter) parts.push(`text ~ ${quote(query)}`);
  return `${parts.join(" AND ")} ORDER BY ${input.sort} DESC, key DESC`;
}

function toActor(person: typeof Person.Type): IssueActor {
  return {
    login: person.accountId,
    name: person.displayName || null,
    avatarUrl: httpsBrowserUrl(person.avatarUrls?.["24x24"]) ?? null,
  };
}

function toSummary(issue: typeof JiraIssue.Type): Omit<TrackerIssueSummary, "jiraWork"> {
  const { fields } = issue;
  const state: IssueState = {
    category: fields.status.statusCategory.key === "done" ? "closed" : "open",
    name: fields.status.name,
  };
  return {
    key: issue.key,
    displayKey: issue.key,
    title: fields.summary,
    url: `https://${JIRA_HOST}/browse/${issue.key}`,
    author: fields.creator ? toActor(fields.creator) : null,
    state,
    createdAt: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(fields.created))),
    updatedAt: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(fields.updated))),
    closedAt: fields.resolutiondate
      ? DateTime.formatIso(DateTime.makeUnsafe(Date.parse(fields.resolutiondate)))
      : null,
    assignees: fields.assignee ? [toActor(fields.assignee)] : [],
    labels: (fields.labels ?? []).map((name) => ({ name, color: null })),
    commentCount: 0,
  };
}

export const make = Effect.gen(function* () {
  const jira = yield* JiraClient.JiraClient;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const readWork = loadTicketWork().pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );

  const enrich = Effect.fn("JiraIssueTracker.enrich")(function* (
    issue: typeof JiraIssue.Type,
    read: Effect.Success<typeof readWork>,
  ) {
    const jiraWork = yield* read(
      issue.key,
      (issue.fields.fixVersions ?? []).map((version) => version.name),
    ).pipe(
      Effect.provideService(ServerEnvironment.ServerEnvironmentIdentity, environment),
      Effect.provideService(Orchestrator.OrchestratorV2, orchestrator),
      Effect.provideService(ProjectService.ProjectService, projects),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(SqlClient.SqlClient, sql),
    );
    return { ...toSummary(issue), jiraWork };
  });

  const request = Effect.fn("JiraIssueTracker.request")(function* <
    S extends Schema.Decoder<unknown>,
  >(operation: string, request: HttpClientRequest.HttpClientRequest, schema: S) {
    const result = yield* jira.execute(request, JIRA_HOST).pipe(
      Effect.timeout("20 seconds"),
      Effect.mapError(
        (cause) =>
          new IssueTrackerError({
            tracker: JIRA_TRACKER,
            operation,
            reason: cause._tag === "JiraNotConfiguredError" ? "unauthenticated" : "failed",
            detail:
              cause._tag === "JiraNotConfiguredError" ? cause.message : "Could not reach Jira.",
          }),
      ),
    );
    if (result.status !== 200) {
      return yield* new IssueTrackerError({
        tracker: JIRA_TRACKER,
        operation,
        reason:
          result.status === 401
            ? "unauthenticated"
            : result.status === 404
              ? "not-found"
              : result.status === 429
                ? "rate-limited"
                : "failed",
        detail: `Jira returned HTTP ${result.status}.`,
      });
    }
    return yield* Schema.decodeUnknownEffect(schema)(result.body).pipe(
      Effect.mapError(
        () =>
          new IssueTrackerError({
            tracker: JIRA_TRACKER,
            operation,
            reason: "failed",
            detail: "Jira returned an invalid response.",
          }),
      ),
    );
  });

  const getViewer = Effect.fn("JiraIssueTracker.getViewer")(function* () {
    const viewer = yield* request(
      "viewer",
      HttpClientRequest.get("/rest/api/3/myself"),
      Schema.Struct({ accountId: Schema.NonEmptyString }),
    );
    return viewer.accountId;
  });

  const listIssues: IssueTrackerApi["listIssues"] = Effect.fn("JiraIssueTracker.list")(
    function* (input) {
      const jql = jiraListQuery(input);
      if (jql === null) return { items: [], nextCursor: null };
      const page = yield* request(
        "list",
        HttpClientRequest.post("/rest/api/3/search/jql").pipe(
          HttpClientRequest.bodyJsonUnsafe({
            jql,
            fields: fields.split(","),
            maxResults: input.limit,
            ...(input.cursor ? { nextPageToken: input.cursor } : {}),
          }),
        ),
        JiraPage,
      );
      const read = yield* readWork;
      const items = yield* Effect.forEach(
        page.issues.filter((issue) => jiraProject(issue.key) === input.scope.toUpperCase()),
        (issue) => enrich(issue, read),
        { concurrency: 8 },
      );
      return { items, nextCursor: page.isLast ? null : (page.nextPageToken ?? null) };
    },
  );

  const getIssue: IssueTrackerApi["getIssue"] = Effect.fn("JiraIssueTracker.getIssue")(
    function* (input) {
      const project = jiraProject(input.key);
      if (project === undefined || project !== input.scope.toUpperCase()) {
        return yield* new IssueTrackerError({
          tracker: JIRA_TRACKER,
          operation: "detail",
          reason: "not-found",
          detail: "Ticket is outside this Jira project.",
        });
      }
      const raw = yield* request(
        "detail",
        HttpClientRequest.get(`/rest/api/3/issue/${input.key}`).pipe(
          HttpClientRequest.setUrlParams({
            fields: `${fields},${JIRA_DETAIL_FIELDS.join(",")}`,
            expand: "names",
          }),
        ),
        Schema.Unknown,
      );
      const issue = yield* decodeIssue(raw).pipe(
        Effect.mapError(
          (cause) =>
            new IssueTrackerError({
              tracker: JIRA_TRACKER,
              operation: "detail",
              reason: "failed",
              detail: "Jira returned an invalid ticket.",
              cause,
            }),
        ),
      );
      if (jiraProject(issue.key) !== project) {
        return yield* new IssueTrackerError({
          tracker: JIRA_TRACKER,
          operation: "detail",
          reason: "not-found",
          detail: "Ticket moved to a different Jira project.",
        });
      }
      const read = yield* readWork;
      const summary = yield* enrich(issue, read);
      const page = yield* comments(input, undefined);
      return {
        ...summary,
        ...jiraIssueContent(raw),
        commentCount: page.total,
        viewer: null,
        states: [summary.state],
        comments: page.comments,
        commentsCursor: page.nextCursor,
        events: [],
        linkedPullRequests: [],
        viewerPermissions: {
          setState: false,
          edit: false,
          comment: false,
          labels: false,
          assignees: false,
        },
      };
    },
  );

  const comments = Effect.fn("JiraIssueTracker.comments")(function* (
    input: Parameters<IssueTrackerApi["getIssue"]>[0],
    cursor: string | undefined,
  ) {
    if (
      jiraProject(input.key) !== input.scope.toUpperCase() ||
      (cursor !== undefined && !/^\d{1,9}$/u.test(cursor))
    ) {
      return yield* new IssueTrackerError({
        tracker: JIRA_TRACKER,
        operation: "comments",
        reason: "not-found",
        detail: "Invalid Jira ticket or comment page.",
      });
    }
    const page = yield* request(
      "comments",
      HttpClientRequest.get(`/rest/api/3/issue/${input.key}/comment`).pipe(
        HttpClientRequest.setUrlParams({
          startAt: cursor ?? "0",
          maxResults: "30",
          orderBy: "-created",
        }),
      ),
      CommentPage,
    );
    const next = page.startAt + page.comments.length;
    return {
      comments: [...page.comments].reverse().map((comment) => ({
        id: comment.id,
        author: comment.author ? toActor(comment.author) : null,
        body: jiraDocument(comment.body),
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(comment.created))),
        url: `https://${JIRA_HOST}/browse/${input.key}?focusedCommentId=${encodeURIComponent(comment.id)}`,
      })),
      total: page.total,
      nextCursor: page.comments.length > 0 && next < page.total ? String(next) : null,
    };
  });

  return {
    kind: JIRA_TRACKER,
    capabilities: {
      create: false,
      edit: false,
      comment: false,
      labels: false,
      assignees: false,
      reactions: false,
      templates: false,
      linkedPullRequests: false,
      events: false,
      search: true,
    },
    getViewer,
    listIssues,
    getIssue,
    getComments: (input) => comments(input, input.cursor),
  } satisfies IssueTrackerApi;
});
