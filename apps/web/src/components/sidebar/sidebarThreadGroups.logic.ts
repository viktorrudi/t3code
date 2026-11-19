import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { isSidebarGroupMarker, sidebarListItemId, type SidebarListItem } from "../Sidebar.logic";

/**
 * A sidebar thread group. Groups are this client's arrangement, like folder and shelf
 * expansion; members are scoped thread keys, so one group can span environments.
 */
export const SidebarThreadGroup = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** A title the user typed; generated titles never replace it. */
  titleEdited: Schema.Boolean,
  members: Schema.Array(Schema.String),
  collapsed: Schema.Boolean,
});
export type SidebarThreadGroup = typeof SidebarThreadGroup.Type;

export const SidebarThreadGroups = Schema.Array(SidebarThreadGroup);
export type SidebarThreadGroups = typeof SidebarThreadGroups.Type;

export type SidebarGroupDropTarget =
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "group"; readonly id: string };

type GroupMemberShell = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "title" | "latestUserMessageAt" | "latestRun" | "updatedAt"
>;

const threadKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function sameGroupDropTarget(
  left: SidebarGroupDropTarget | null,
  right: SidebarGroupDropTarget | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === "thread"
    ? right.kind === "thread" && left.key === right.key
    : right.kind === "group" && left.id === right.id;
}

function groupOfThread(groups: SidebarThreadGroups, key: string): SidebarThreadGroup | undefined {
  return groups.find((group) => group.members.includes(key));
}

/** Takes threads out of their groups; a group left with one member dissolves. */
export function removeThreadsFromGroups(
  groups: SidebarThreadGroups,
  keys: ReadonlyArray<string>,
): SidebarThreadGroups {
  const removed = new Set(keys);
  if (!groups.some((group) => group.members.some((key) => removed.has(key)))) return groups;
  return groups.flatMap((group) => {
    if (!group.members.some((key) => removed.has(key))) return [group];
    const members = group.members.filter((key) => !removed.has(key));
    return members.length < 2 ? [] : [{ ...group, members }];
  });
}

/**
 * Drops one thread on a row or a group header. A grouped target takes the thread in;
 * an ungrouped one forms a new group, listed first. Returns null when nothing changes.
 */
export function dropThreadIntoGroup(
  groups: SidebarThreadGroups,
  sourceKey: string,
  target: SidebarGroupDropTarget,
  newGroup: { readonly id: string; readonly title: string },
): { readonly groups: SidebarThreadGroups; readonly groupId: string } | null {
  if (target.kind === "thread" && target.key === sourceKey) return null;
  const targetGroup =
    target.kind === "group"
      ? groups.find((group) => group.id === target.id)
      : groupOfThread(groups, target.key);
  if (target.kind === "group" && targetGroup === undefined) return null;
  if (targetGroup?.members.includes(sourceKey)) return null;
  const others = removeThreadsFromGroups(groups, [sourceKey]);
  if (targetGroup !== undefined) {
    return {
      groupId: targetGroup.id,
      groups: others.map((group) =>
        group.id === targetGroup.id ? { ...group, members: [...group.members, sourceKey] } : group,
      ),
    };
  }
  const targetKey = target.kind === "thread" ? target.key : sourceKey;
  return {
    groupId: newGroup.id,
    groups: [
      {
        id: newGroup.id,
        title: newGroup.title,
        titleEdited: false,
        members: [targetKey, sourceKey],
        collapsed: false,
      },
      ...others,
    ],
  };
}

export function releaseGroup(groups: SidebarThreadGroups, id: string): SidebarThreadGroups {
  return groups.filter((group) => group.id !== id);
}

export function updateGroup(
  groups: SidebarThreadGroups,
  id: string,
  update: Partial<Pick<SidebarThreadGroup, "title" | "titleEdited" | "collapsed">>,
): SidebarThreadGroups {
  const index = groups.findIndex((group) => group.id === id);
  const current = groups[index];
  if (
    current === undefined ||
    Object.entries(update).every(
      ([field, value]) => current[field as keyof typeof update] === value,
    )
  ) {
    return groups;
  }
  return groups.map((group) => (group.id === id ? { ...group, ...update } : group));
}

/**
 * Moves a group to `toIndex` among the listed groups. Groups the sidebar hides (another
 * project scope, or no loaded members) keep their places relative to their neighbours.
 */
export function moveGroup(
  groups: SidebarThreadGroups,
  id: string,
  listedIds: ReadonlyArray<string>,
  toIndex: number,
): SidebarThreadGroups {
  const moving = groups.find((group) => group.id === id);
  const others = listedIds.filter((listedId) => listedId !== id);
  if (moving === undefined || others.length === 0 || listedIds.indexOf(id) === toIndex) {
    return groups;
  }
  const rest = groups.filter((group) => group.id !== id);
  const before = others[toIndex];
  const at =
    before === undefined
      ? rest.findIndex((group) => group.id === others.at(-1)) + 1
      : rest.findIndex((group) => group.id === before);
  if (at < 0) return groups;
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
  return next.every((group, index) => group === groups[index]) ? groups : next;
}

/** Where a header dragged to `pointerY` lands among the listed groups' blocks. */
export function resolveGroupReorderIndex(
  blocks: ReadonlyArray<{ readonly id: string; readonly top: number; readonly bottom: number }>,
  id: string,
  pointerY: number,
): number {
  return blocks.filter((block) => block.id !== id && (block.top + block.bottom) / 2 < pointerY)
    .length;
}

export function expandGroups(
  groups: SidebarThreadGroups,
  ids: ReadonlySet<string>,
): SidebarThreadGroups {
  if (!groups.some((group) => group.collapsed && ids.has(group.id))) return groups;
  return groups.map((group) =>
    group.collapsed && ids.has(group.id) ? { ...group, collapsed: false } : group,
  );
}

function activityMs(thread: GroupMemberShell): number {
  const timestamp = resolveThreadActivityTimestamp(thread);
  const ms = timestamp === null ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : 0;
}

/** Most recently worked on first. */
function sortGroupMembers<T extends GroupMemberShell>(members: readonly T[]): T[] {
  return members
    .map((thread) => ({ thread, ms: activityMs(thread), key: threadKey(thread) }))
    .sort((left, right) => right.ms - left.ms || (left.key < right.key ? -1 : 1))
    .map(({ thread }) => thread);
}

/** The project most members belong to; ties go to the most recently worked on. */
function resolveGroupProject(
  sortedMembers: ReadonlyArray<Pick<EnvironmentThreadShell, "environmentId" | "projectId">>,
): { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null {
  const counts = new Map<
    string,
    { count: number; environmentId: EnvironmentId; projectId: ProjectId }
  >();
  let best: { count: number; environmentId: EnvironmentId; projectId: ProjectId } | null = null;
  for (const member of sortedMembers) {
    const key = `${member.environmentId}:${member.projectId}`;
    const entry = counts.get(key) ?? {
      count: 0,
      environmentId: member.environmentId,
      projectId: member.projectId,
    };
    entry.count += 1;
    counts.set(key, entry);
    if (best === null || entry.count > best.count) best = entry;
  }
  return best === null ? null : { environmentId: best.environmentId, projectId: best.projectId };
}

export interface ArrangedSidebarThreadGroup<T> {
  readonly group: SidebarThreadGroup;
  readonly members: readonly T[];
  readonly project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null;
}

/** Lists each group with its visible members; a group with none stays hidden. */
export function arrangeSidebarThreadGroups<T extends GroupMemberShell>(
  groups: SidebarThreadGroups,
  visibleThreads: readonly T[],
): ReadonlyArray<ArrangedSidebarThreadGroup<T>> {
  if (groups.length === 0) return [];
  const byKey = new Map(visibleThreads.map((thread) => [threadKey(thread), thread] as const));
  return groups.flatMap((group) => {
    const members = sortGroupMembers(
      group.members.flatMap((key) => {
        const thread = byKey.get(key);
        return thread === undefined ? [] : [thread];
      }),
    );
    return members.length === 0 ? [] : [{ group, members, project: resolveGroupProject(members) }];
  });
}

/** What the group's title is generated from: its project and its members' titles. */
export function groupTitleRequest(members: ReadonlyArray<GroupMemberShell>) {
  const sorted = sortGroupMembers(members);
  const project = resolveGroupProject(sorted);
  const threadTitles = [
    ...new Set(sorted.map((thread) => thread.title.trim()).filter((title) => title.length > 0)),
  ].slice(0, 50);
  if (project === null || threadTitles.length === 0) return null;
  return { environmentId: project.environmentId, projectId: project.projectId, threadTitles };
}

/**
 * Reports members whose run completed since the last observation. Completions before
 * `since` (work that finished before this client looked) and members seen for the first
 * time never count, so loading or reconnecting does not open groups.
 */
export function observeGroupMemberCompletions(input: {
  readonly seen: Map<string, number | null>;
  readonly members: ReadonlyArray<{
    readonly key: string;
    readonly completedAt: string | null | undefined;
    readonly working: boolean;
  }>;
  readonly since: number;
}): string[] {
  const finished: string[] = [];
  for (const member of input.members) {
    const parsed = member.completedAt == null ? Number.NaN : Date.parse(member.completedAt);
    const completedMs = Number.isFinite(parsed) ? parsed : null;
    const known = input.seen.has(member.key);
    const previous = input.seen.get(member.key) ?? null;
    input.seen.set(member.key, completedMs);
    if (
      known &&
      !member.working &&
      completedMs !== null &&
      completedMs > input.since &&
      (previous === null || completedMs > previous)
    ) {
      finished.push(member.key);
    }
  }
  return finished;
}

type Rect = { readonly top: number; readonly height: number };

/**
 * The row or group header the dragged row rests on. Rows count only through their
 * middle half, so their edges still reorder; a header counts across its height.
 */
export function findGroupDropCandidate(input: {
  readonly collisionRect: Rect;
  readonly droppableRects: ReadonlyMap<string | number, Rect>;
  readonly items: readonly SidebarListItem[];
  readonly activeKey: string;
  readonly groupIdByThreadKey: ReadonlyMap<string, string>;
}): SidebarGroupDropTarget | null {
  const centerY = input.collisionRect.top + input.collisionRect.height / 2;
  const sourceGroup = input.groupIdByThreadKey.get(input.activeKey);
  for (const item of input.items) {
    const id = sidebarListItemId(item);
    if (id === input.activeKey) continue;
    const rect = input.droppableRects.get(id);
    if (rect === undefined || rect.height === 0) continue;
    if (item.kind === "thread") {
      if (Math.abs(centerY - (rect.top + rect.height / 2)) > rect.height / 4) continue;
      const targetGroup = input.groupIdByThreadKey.get(item.key);
      return sourceGroup !== undefined && targetGroup === sourceGroup
        ? null
        : { kind: "thread", key: item.key };
    }
    if (!isSidebarGroupMarker(item.marker)) continue;
    if (centerY < rect.top || centerY > rect.top + rect.height) continue;
    const groupId = item.marker.slice("group:".length);
    return groupId === sourceGroup ? null : { kind: "group", id: groupId };
  }
  return null;
}
