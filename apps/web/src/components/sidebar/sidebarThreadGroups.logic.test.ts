import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  arrangeSidebarThreadGroups,
  dropThreadIntoGroup,
  groupTitleRequest,
  moveGroup,
  observeGroupMemberCompletions,
  removeThreadsFromGroups,
  resolveGroupReorderIndex,
  type SidebarThreadGroup,
} from "./sidebarThreadGroups.logic";

const group = (id: string, members: string[], collapsed = false): SidebarThreadGroup => ({
  id,
  title: id,
  titleEdited: false,
  members,
  collapsed,
});
const newGroup = { id: "new", title: "Target title" };

const shell = (
  environment: string,
  id: string,
  options: { project?: string; title?: string; activity?: string } = {},
) => ({
  environmentId: EnvironmentId.make(environment),
  id: ThreadId.make(id),
  projectId: ProjectId.make(options.project ?? "p"),
  title: options.title ?? id,
  latestUserMessageAt: options.activity ?? "2026-01-01T00:00:00.000Z",
  latestRun: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("sidebar thread group membership", () => {
  it("forms a new group, listed first, from two ungrouped threads", () => {
    const result = dropThreadIntoGroup(
      [group("old", ["e:x", "e:y"])],
      "e:a",
      {
        kind: "thread",
        key: "e:b",
      },
      newGroup,
    );
    expect(result?.groupId).toBe("new");
    expect(result?.groups.map(({ id, members }) => [id, members])).toEqual([
      ["new", ["e:b", "e:a"]],
      ["old", ["e:x", "e:y"]],
    ]);
  });

  it.each([
    ["a grouped row", { kind: "thread", key: "e:y" }],
    ["its header", { kind: "group", id: "old" }],
  ] as const)("adds a thread dropped on %s to that group", (_, target) => {
    const result = dropThreadIntoGroup([group("old", ["e:x", "e:y"])], "e:a", target, newGroup);
    expect(result?.groupId).toBe("old");
    expect(result?.groups).toEqual([group("old", ["e:x", "e:y", "e:a"])]);
  });

  it("moves a thread between groups and dissolves the group it leaves alone", () => {
    const result = dropThreadIntoGroup(
      [group("from", ["e:a", "e:b"]), group("to", ["e:x", "e:y"])],
      "e:a",
      { kind: "group", id: "to" },
      newGroup,
    );
    expect(result?.groups).toEqual([group("to", ["e:x", "e:y", "e:a"])]);
  });

  it("changes nothing for a drop on itself or its own group", () => {
    const groups = [group("g", ["e:a", "e:b"])];
    expect(dropThreadIntoGroup(groups, "e:a", { kind: "thread", key: "e:a" }, newGroup)).toBeNull();
    expect(dropThreadIntoGroup(groups, "e:a", { kind: "thread", key: "e:b" }, newGroup)).toBeNull();
    expect(dropThreadIntoGroup(groups, "e:a", { kind: "group", id: "g" }, newGroup)).toBeNull();
    expect(dropThreadIntoGroup(groups, "e:a", { kind: "group", id: "gone" }, newGroup)).toBeNull();
  });

  it("dissolves a group left with one member and keeps larger ones", () => {
    const groups = [group("pair", ["e:a", "e:b"]), group("trio", ["e:x", "e:y", "e:z"])];
    expect(removeThreadsFromGroups(groups, ["e:a", "e:x"])).toEqual([
      group("trio", ["e:y", "e:z"]),
    ]);
    expect(removeThreadsFromGroups(groups, ["e:none"])).toBe(groups);
  });
});

describe("sidebar thread group arrangement", () => {
  it("keeps members apart by environment, lists the latest work first, and hides empty groups", () => {
    const threads = [
      shell("local", "t", { activity: "2026-01-01T00:00:00.000Z" }),
      shell("remote", "t", { project: "q", activity: "2026-01-03T00:00:00.000Z" }),
      shell("local", "u", { activity: "2026-01-02T00:00:00.000Z" }),
    ];
    const arranged = arrangeSidebarThreadGroups(
      [group("g", ["local:t", "remote:t", "local:u"]), group("empty", ["local:gone", "x:y"])],
      threads,
    );
    expect(arranged.map(({ group }) => group.id)).toEqual(["g"]);
    expect(arranged[0]!.members.map((thread) => `${thread.environmentId}:${thread.id}`)).toEqual([
      "remote:t",
      "local:u",
      "local:t",
    ]);
    // Two of three members share a project, though the latest is elsewhere.
    expect(arranged[0]!.project).toEqual({ environmentId: "local", projectId: "p" });
  });

  it("titles a group from its project and unique member titles", () => {
    expect(
      groupTitleRequest([
        shell("local", "a", { title: " Fix login " }),
        shell("local", "b", { title: "Fix login", activity: "2026-02-01T00:00:00.000Z" }),
        shell("local", "c", { title: "Add OAuth" }),
      ]),
    ).toEqual({
      environmentId: "local",
      projectId: "p",
      threadTitles: ["Fix login", "Add OAuth"],
    });
  });

  it("moves a group among listed groups and leaves hidden groups beside their neighbours", () => {
    const groups = [group("a", []), group("hidden", []), group("b", []), group("c", [])];
    const listed = ["a", "b", "c"];
    expect(moveGroup(groups, "c", listed, 0).map(({ id }) => id)).toEqual([
      "c",
      "a",
      "hidden",
      "b",
    ]);
    expect(moveGroup(groups, "a", listed, 2).map(({ id }) => id)).toEqual([
      "hidden",
      "b",
      "c",
      "a",
    ]);
    expect(moveGroup(groups, "a", listed, 0)).toBe(groups);
  });

  it("places a dragged header by the midpoints of the other group blocks", () => {
    const blocks = [
      { id: "a", top: 0, bottom: 100 },
      { id: "b", top: 100, bottom: 132 },
      { id: "c", top: 132, bottom: 200 },
    ];
    expect(resolveGroupReorderIndex(blocks, "c", 10)).toBe(0);
    expect(resolveGroupReorderIndex(blocks, "c", 60)).toBe(1);
    expect(resolveGroupReorderIndex(blocks, "a", 190)).toBe(2);
  });
});

describe("sidebar thread group completions", () => {
  it("opens for newer completions after the first observation", () => {
    const seen = new Map<string, number | null>();
    const observe = (members: Array<{ key: string; completedAt: string | null }>) =>
      observeGroupMemberCompletions(seen, members);
    expect(
      observe([
        { key: "e:idle", completedAt: "2026-01-01T12:00:00.000Z" },
        { key: "e:running", completedAt: null },
      ]),
    ).toEqual([]);
    expect(
      observe([
        { key: "e:idle", completedAt: null },
        { key: "e:running", completedAt: "2026-01-01T12:05:00.000Z" },
      ]),
    ).toEqual(["e:running"]);
    expect(
      observe([
        { key: "e:idle", completedAt: "2026-01-01T12:00:00.000Z" },
        { key: "e:running", completedAt: "2026-01-01T12:05:00.000Z" },
        { key: "e:loaded", completedAt: "2026-01-01T12:05:00.000Z" },
      ]),
    ).toEqual([]);
  });
});
