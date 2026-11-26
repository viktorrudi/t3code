import { describe, expect, it } from "vite-plus/test";

import { IssueTrackerKind, ProjectId, type ThreadIssueLink } from "@t3tools/contracts";

import { jiraTicketIssueTarget, mergeThreadJiraTickets } from "./threadJiraTickets.ts";

function link(key: string, overrides: Partial<ThreadIssueLink> = {}): ThreadIssueLink {
  return {
    tracker: IssueTrackerKind.make("jira"),
    host: "SensoneoSK.atlassian.net",
    scope: key.split("-")[0]!,
    key,
    projectId: ProjectId.make("jira-project"),
    url: `https://sensoneosk.atlassian.net/browse/${key}`,
    source: "agent",
    linkedAt: "2026-11-24T10:00:00.000Z",
    displayKey: key,
    title: `Title ${key}`,
    ...overrides,
  } as ThreadIssueLink;
}

describe("mergeThreadJiraTickets", () => {
  it("shows a ticket linked both ways once and keeps legacy and native-only tickets", () => {
    const merged = mergeThreadJiraTickets(
      [
        {
          key: "FED-1",
          url: "https://sensoneosk.atlassian.net/browse/FED-1",
          deploy: { label: "QA", tone: "info" },
        },
        { key: "RET-2", url: "https://sensoneosk.atlassian.net/browse/RET-2" },
      ],
      [
        link("FED-1"),
        link("FED-1", { projectId: ProjectId.make("other") }),
        link("FED-9"),
        link("FED-1", { tracker: IssueTrackerKind.make("github") }),
        link("RET-2", { host: "other.atlassian.net" }),
      ],
    );
    expect(
      merged.map((ticket) => [ticket.key, ticket.annotated, ticket.link?.host ?? null]),
    ).toEqual([
      ["FED-1", true, "SensoneoSK.atlassian.net"],
      ["RET-2", true, null],
      ["FED-9", false, "SensoneoSK.atlassian.net"],
      ["RET-2", false, "other.atlassian.net"],
    ]);
    expect(merged[0]?.deploy?.label).toBe("QA");
    expect(merged[0]?.link?.projectId).toBe("jira-project");
  });

  it("opens a legacy annotation through the thread's project", () => {
    const [legacy] = mergeThreadJiraTickets(
      [{ key: "RET-2", url: "https://sensoneosk.atlassian.net/browse/RET-2" }],
      undefined,
    );
    expect(jiraTicketIssueTarget(legacy!, "thread-project")).toEqual({
      projectId: "thread-project",
      tracker: "jira",
      host: "sensoneosk.atlassian.net",
      scope: "RET",
      key: "RET-2",
      url: "https://sensoneosk.atlassian.net/browse/RET-2",
    });
  });
});
