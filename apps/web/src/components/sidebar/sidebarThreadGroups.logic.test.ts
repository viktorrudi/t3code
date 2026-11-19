import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { sidebarMarkerId, type SidebarListItem } from "../Sidebar.logic";
import {
  arrangeSidebarThreadGroups,
  dropThreadIntoGroup,
  findGroupDropCandidate,
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
  const since = Date.parse("2026-01-01T12:00:00.000Z");

  it("opens only for runs this client saw finish, not for work loaded or reconnected", () => {
    const seen = new Map<string, number | null>();
    const observe = (
      members: Array<{ key: string; completedAt: string | null; working: boolean }>,
    ) => observeGroupMemberCompletions({ seen, members, since });

    // First sight, even of a run that finished after this client started, never counts.
    expect(
      observe([
        { key: "e:old", completedAt: "2026-01-01T11:00:00.000Z", working: false },
        { key: "e:late", completedAt: "2026-01-01T12:05:00.000Z", working: false },
        { key: "e:run", completedAt: null, working: true },
      ]),
    ).toEqual([]);
    // A stale snapshot replaced by one holding an earlier completion does not count either.
    expect(
      observe([
        { key: "e:old", completedAt: "2026-01-01T11:30:00.000Z", working: false },
        { key: "e:late", completedAt: "2026-01-01T12:05:00.000Z", working: false },
        { key: "e:run", completedAt: null, working: true },
      ]),
    ).toEqual([]);
    expect(
      observe([
        { key: "e:old", completedAt: "2026-01-01T11:30:00.000Z", working: false },
        { key: "e:late", completedAt: "2026-01-01T12:05:00.000Z", working: false },
        { key: "e:run", completedAt: "2026-01-01T12:10:00.000Z", working: false },
      ]),
    ).toEqual(["e:run"]);
  });
});

describe("sidebar group drop candidates", () => {
  const items: SidebarListItem[] = [
    { kind: "thread", key: "source", section: "active" },
    { kind: "thread", key: "target", section: "active" },
    { kind: "marker", marker: "group:g" },
    { kind: "thread", key: "member", section: "grouped" },
  ];
  const droppableRects = new Map<string, { top: number; height: number }>([
    ["source", { top: 0, height: 80 }],
    ["target", { top: 100, height: 80 }],
    [sidebarMarkerId("group:g"), { top: 200, height: 32 }],
    ["member", { top: 240, height: 36 }],
  ]);
  const candidateAt = (centerY: number, groupIdByThreadKey = new Map([["member", "g"]])) =>
    findGroupDropCandidate({
      collisionRect: { top: centerY - 40, height: 80 },
      droppableRects,
      items,
      activeKey: "source",
      groupIdByThreadKey,
    });

  it("groups through a row's middle half and leaves its edges to reordering", () => {
    expect(candidateAt(140)).toEqual({ kind: "thread", key: "target" });
    expect(candidateAt(105)).toBeNull();
    expect(candidateAt(175)).toBeNull();
  });

  it("takes a group header across its height", () => {
    expect(candidateAt(201)).toEqual({ kind: "group", id: "g" });
    expect(candidateAt(258)).toEqual({ kind: "thread", key: "member" });
  });

  it("ignores the dragged row's own group", () => {
    const own = new Map([
      ["member", "g"],
      ["source", "g"],
    ]);
    expect(candidateAt(216, own)).toBeNull();
    expect(candidateAt(258, own)).toBeNull();
  });
});
