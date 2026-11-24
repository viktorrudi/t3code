import { describe, expect, it } from "@effect/vitest";

import { jiraListQuery } from "./JiraIssueTracker.ts";

const input = {
  cwd: "/work",
  scope: "RET",
  host: "sensoneosk.atlassian.net",
  state: "open",
  involvement: "assigned",
  viewer: "account",
  sort: "updated",
  limit: 50,
} as const;

describe("Sensoneo Jira queries", () => {
  it("uses Jira's viewer and keeps plain text within a quoted JQL value", () => {
    expect(jiraListQuery({ ...input, query: 'invoice" OR project = "GRE' })).toBe(
      'project = "RET" AND statusCategory != Done AND assignee = currentUser() AND text ~ "invoice\\" OR project = \\"GRE" ORDER BY updated DESC, key DESC',
    );
  });

  it("visits only the selected project for an exact key or project search", () => {
    expect(jiraListQuery({ ...input, query: "gre45" })).toBeNull();
    expect(jiraListQuery({ ...input, query: "DRSI" })).toBeNull();
    expect(jiraListQuery({ ...input, involvement: "all", state: "all", query: "ret45" })).toBe(
      'project = "RET" AND key = "RET-45" ORDER BY updated DESC, key DESC',
    );
  });
});
