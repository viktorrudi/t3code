import type { ThreadGroup } from "../../persistence/mobile-preferences";
import {
  withThreadListV2Dividers,
  type ThreadListV2ListItem,
  type ThreadListV2ThreadListItem,
} from "./threadListV2";

export function moveThreadToGroup(
  groups: ReadonlyArray<ThreadGroup>,
  threadKey: string,
  targetId: string | null,
): ReadonlyArray<ThreadGroup> {
  if (targetId !== null && !groups.some((group) => group.id === targetId)) return groups;
  return groups.flatMap((group) => {
    if (group.id === targetId) {
      return [
        group.members.includes(threadKey)
          ? group
          : { ...group, members: [...group.members, threadKey], collapsed: false },
      ];
    }
    if (!group.members.includes(threadKey)) return [group];
    const members = group.members.filter((key) => key !== threadKey);
    return members.length > 0 ? [{ ...group, members }] : [];
  });
}

export function groupActiveThreadRows(
  rows: ReadonlyArray<ThreadListV2ListItem>,
  groups: ReadonlyArray<ThreadGroup>,
): ReadonlyArray<ThreadListV2ListItem> {
  if (groups.length === 0 || rows.length === 0) return rows;
  const byThread = new Map<string, ThreadGroup>();
  for (const group of groups) {
    for (const key of group.members) {
      if (!byThread.has(key)) byThread.set(key, group);
    }
  }
  const firstActive = rows.findIndex(
    (row) => row.type === "v2-thread" && row.item.variant === "card" && !row.item.pinned,
  );
  if (firstActive < 0) return rows;
  const shelf = rows.findIndex(
    (row) =>
      row.type === "v2-working-shelf" ||
      row.type === "v2-snoozed-shelf" ||
      row.type === "v2-settled-shelf",
  );
  if (shelf >= 0 && shelf <= firstActive) return rows;
  const afterActive = shelf < 0 ? rows.length : shelf;
  const members = new Map<string, ThreadListV2ThreadListItem[]>();
  const groupOf = (row: ThreadListV2ListItem | undefined) => {
    if (
      row?.type !== "v2-thread" ||
      row.item.pinned ||
      row.item.snoozed ||
      row.item.variant !== "card"
    )
      return;
    const thread = row.item.thread;
    return byThread.get(`${thread.environmentId}:${thread.id}`);
  };
  const active = rows.slice(firstActive, afterActive);
  const rest = active.flatMap((row, index): ThreadListV2ListItem[] => {
    if (row.type !== "v2-thread") return [row];
    const group = groupOf(row);
    if (!group) {
      const canMoveUp = row.canMoveUp && !groupOf(active[index - 1]);
      const canMoveDown = row.canMoveDown && !groupOf(active[index + 1]);
      return [
        canMoveUp === row.canMoveUp && canMoveDown === row.canMoveDown
          ? row
          : { ...row, canMoveUp, canMoveDown },
      ];
    }
    const present = members.get(group.id) ?? [];
    present.push({ ...row, canMoveUp: false, canMoveDown: false });
    members.set(group.id, present);
    return [];
  });
  if (members.size === 0) return rows;
  return withThreadListV2Dividers([
    ...rows.slice(0, firstActive),
    ...groups.flatMap((group): ThreadListV2ListItem[] => {
      const present = members.get(group.id);
      return present
        ? [
            {
              type: "v2-thread-group",
              key: `v2-thread-group:${group.id}`,
              group,
              count: present.length,
            },
            ...(group.collapsed ? [] : present),
          ]
        : [];
    }),
    ...rest,
    ...rows.slice(afterActive),
  ]);
}
