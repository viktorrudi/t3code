import type { IssueDetail, IssueState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { issueDisplayActor, issueWriteAccess } from "./issuePresentation.ts";

const workflow: ReadonlyArray<IssueState> = [
  { category: "open", name: "Backlog" },
  { category: "open", name: "Todo" },
  { category: "open", name: "In Progress" },
  { category: "closed", name: "Done", closeReason: "completed" },
  { category: "closed", name: "Canceled", closeReason: "canceled" },
  { category: "closed", name: "Duplicate", closeReason: "duplicate" },
];

function issue(overrides: { writable?: boolean; setState?: boolean; states?: typeof workflow }) {
  return {
    writable: overrides.writable ?? true,
    state: { category: "open", name: "Todo" },
    states: overrides.states ?? workflow,
    capabilities: {},
    viewerPermissions: { setState: overrides.setState ?? true },
  } as unknown as IssueDetail;
}

describe("issueWriteAccess", () => {
  it("offers every other state of the issue's workflow, in the tracker's order", () => {
    expect(issueWriteAccess(issue({}), true).states.map((state) => state.name)).toEqual([
      "Backlog",
      "In Progress",
      "Done",
      "Canceled",
      "Duplicate",
    ]);
  });

  it("offers no state when the issue cannot be moved", () => {
    expect(issueWriteAccess(issue({ setState: false }), true).states).toEqual([]);
    expect(issueWriteAccess(issue({ writable: false }), true).states).toEqual([]);
    expect(issueWriteAccess(issue({}), false).states).toEqual([]);
    expect(issueWriteAccess(issue({ states: [] }), true).states).toEqual([]);
  });
});

describe("issueDisplayActor", () => {
  it("shows Jira people by name and leaves other trackers and nameless actors alone", () => {
    const person = { login: "712020:5f1c-account-id", name: "Jane Reporter", avatarUrl: null };
    expect(issueDisplayActor("jira", person)?.login).toBe("Jane Reporter");
    expect(issueDisplayActor("github", person)).toBe(person);
    const nameless = { ...person, name: null };
    expect(issueDisplayActor("jira", nameless)).toBe(nameless);
    expect(issueDisplayActor("jira", null)).toBeNull();
  });
});
