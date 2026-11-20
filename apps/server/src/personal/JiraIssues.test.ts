import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import type { HttpClientRequest } from "effect/http";

import * as JiraClient from "./JiraClient.ts";
import * as JiraIssues from "./JiraIssues.ts";
import { parseThreadAnnotations } from "./ThreadTickets.ts";

const status = (name: string, key: string) => ({ name, statusCategory: { key } });

it.effect("maps a Jira issue, posts a transition and reports Jira refusals", () =>
  Effect.gen(function* () {
    const requests: Array<{ method: string; url: string }> = [];
    let transitionStatus = 204;
    const execute = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.sync(() => {
        requests.push({ method: request.method, url: request.url });
        const origin = "https://jira.example.test";
        if (request.method === "POST") return { status: transitionStatus, body: null, origin };
        if (request.url.endsWith("/transitions")) {
          return {
            status: 200,
            origin,
            body: {
              transitions: [
                {
                  id: "31",
                  name: "Fix ready",
                  to: status("Waiting for deployment", "indeterminate"),
                },
              ],
            },
          };
        }
        return {
          status: 200,
          origin,
          body: {
            key: "RET-1234",
            fields: {
              summary: "Location filter",
              status: status("In Progress", "indeterminate"),
              issuetype: { name: "Bug" },
              assignee: { displayName: "Ada", avatarUrls: { "24x24": "https://a.test/ada" } },
            },
          },
        };
      });
    const issues = yield* JiraIssues.JiraIssues.pipe(
      Effect.provide(
        JiraIssues.layer.pipe(Layer.provide(Layer.mock(JiraClient.JiraClient)({ execute }))),
      ),
    );

    const issue = yield* issues.get({ key: "RET-1234" });
    assert.deepStrictEqual(issue, {
      key: "RET-1234",
      url: "https://jira.example.test/browse/RET-1234",
      summary: "Location filter",
      issueType: "Bug",
      status: { name: "In Progress", category: "indeterminate" },
      assignee: { displayName: "Ada", avatarUrl: "https://a.test/ada" },
      transitions: [
        {
          id: "31",
          name: "Fix ready",
          toStatus: "Waiting for deployment",
          toCategory: "indeterminate",
        },
      ],
    });

    requests.length = 0;
    yield* issues.transition({ key: "RET-1234", transitionId: "31" });
    assert.deepStrictEqual(requests[0], {
      method: "POST",
      url: "/rest/api/3/issue/RET-1234/transitions",
    });

    transitionStatus = 400;
    const refused = yield* issues
      .transition({ key: "RET-1234", transitionId: "31" })
      .pipe(Effect.result);
    assert.isTrue(Result.isFailure(refused));
  }),
);

it("keeps valid tickets from an annotations file and drops malformed ones", () => {
  const parsed = parseThreadAnnotations(
    JSON.stringify({
      version: 1,
      threads: {
        a: {
          tickets: [
            { key: "RET-1", url: "https://j/RET-1", flag: "🇷🇴" },
            { key: "not a key", url: "https://j/x" },
            { key: "DRSI-2", url: "https://j/DRSI-2", deploy: { label: "✅ UAT", tone: "loud" } },
          ],
        },
        b: { tickets: "nope" },
      },
    }),
  );
  assert.deepStrictEqual(parsed, {
    threads: { a: [{ key: "RET-1", url: "https://j/RET-1", flag: "🇷🇴" }] },
  });
  assert.deepStrictEqual(parseThreadAnnotations("{broken"), { threads: {} });
});
