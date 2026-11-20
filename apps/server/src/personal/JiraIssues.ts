import {
  JiraIssueError,
  type JiraIssueDetails,
  type JiraIssueInput,
  type JiraIssueStatusCategory,
  type JiraIssueTransitionInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClientRequest } from "effect/http";

import * as JiraClient from "./JiraClient.ts";

/** Reads a Jira issue for the chat header and moves it through its workflow. */
export class JiraIssues extends Context.Service<
  JiraIssues,
  {
    readonly get: (input: JiraIssueInput) => Effect.Effect<JiraIssueDetails, JiraIssueError>;
    readonly transition: (
      input: JiraIssueTransitionInput,
    ) => Effect.Effect<JiraIssueDetails, JiraIssueError>;
  }
>()("t3/personal/JiraIssues") {}

const StatusCategory = Schema.Struct({ key: Schema.String });
const Status = Schema.Struct({ name: Schema.String, statusCategory: StatusCategory });
const IssueResponse = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    status: Status,
    issuetype: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    assignee: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          displayName: Schema.String,
          avatarUrls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
    ),
  }),
});
const TransitionsResponse = Schema.Struct({
  transitions: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, to: Status })),
});
const decodeIssue = Schema.decodeUnknownEffect(IssueResponse);
const decodeTransitions = Schema.decodeUnknownEffect(TransitionsResponse);
const isJiraIssueError = Schema.is(JiraIssueError);

const category = (key: string): JiraIssueStatusCategory =>
  key === "new" || key === "indeterminate" || key === "done" ? key : "unknown";

function failureDetail(status: number): string {
  if (status === 401 || status === 403) return "Jira refused the request. Check the Jira token.";
  if (status === 404) return "Jira issue not found, or the token cannot see it.";
  if (status === 400 || status === 409) return "Jira rejected the status change.";
  return `Jira answered ${status}.`;
}

const make = Effect.gen(function* () {
  const jira = yield* JiraClient.JiraClient;

  const request = Effect.fn("JiraIssues.request")(function* (
    key: string,
    httpRequest: HttpClientRequest.HttpClientRequest,
    expected: number,
  ) {
    const response = yield* jira.execute(httpRequest);
    if (response.status !== expected) {
      return yield* new JiraIssueError({ key, detail: failureDetail(response.status) });
    }
    return response;
  });

  const get = Effect.fn("JiraIssues.get")(
    function* (input: JiraIssueInput) {
      const path = `/rest/api/3/issue/${encodeURIComponent(input.key)}`;
      const [issueResponse, transitionsResponse] = yield* Effect.all(
        [
          request(
            input.key,
            HttpClientRequest.get(path).pipe(
              HttpClientRequest.setUrlParams({ fields: "summary,status,assignee,issuetype" }),
            ),
            200,
          ),
          request(input.key, HttpClientRequest.get(`${path}/transitions`), 200),
        ],
        { concurrency: 2 },
      );
      const issue = yield* decodeIssue(issueResponse.body);
      const { transitions } = yield* decodeTransitions(transitionsResponse.body);
      const { fields } = issue;
      return {
        key: input.key,
        url: `${issueResponse.origin}/browse/${encodeURIComponent(issue.key)}`,
        summary: fields.summary,
        issueType: fields.issuetype?.name ?? null,
        status: { name: fields.status.name, category: category(fields.status.statusCategory.key) },
        assignee:
          fields.assignee == null
            ? null
            : {
                displayName: fields.assignee.displayName,
                avatarUrl: fields.assignee.avatarUrls?.["24x24"] ?? null,
              },
        transitions: transitions.map((transition) => ({
          id: transition.id,
          name: transition.name,
          toStatus: transition.to.name,
          toCategory: category(transition.to.statusCategory.key),
        })),
      } satisfies JiraIssueDetails;
    },
    Effect.timeout("25 seconds"),
    Effect.mapError((cause) =>
      isJiraIssueError(cause)
        ? cause
        : new JiraIssueError({
            key: "",
            detail:
              cause._tag === "JiraNotConfiguredError" ? cause.message : "Could not read Jira.",
            cause,
          }),
    ),
  );

  const transition = Effect.fn("JiraIssues.transition")(
    function* (input: JiraIssueTransitionInput) {
      yield* request(
        input.key,
        HttpClientRequest.post(
          `/rest/api/3/issue/${encodeURIComponent(input.key)}/transitions`,
        ).pipe(HttpClientRequest.bodyJsonUnsafe({ transition: { id: input.transitionId } })),
        204,
      );
      return yield* get({ key: input.key });
    },
    Effect.timeout("25 seconds"),
    Effect.mapError((cause) =>
      isJiraIssueError(cause)
        ? cause
        : new JiraIssueError({
            key: "",
            detail:
              cause._tag === "JiraNotConfiguredError"
                ? cause.message
                : "Could not change the Jira status.",
            cause,
          }),
    ),
  );

  return JiraIssues.of({ get, transition });
});

export const layer = Layer.effect(JiraIssues, make);
