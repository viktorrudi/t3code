import type { ContextMenuSource } from "@t3tools/contracts";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SortableSidebarMarker } from "./SidebarListMarkers";
import type { SidebarThreadGroup } from "./sidebarThreadGroups.logic";

const REORDER_DISTANCE = 6;

/** The tree row a group's member rows name as their parent. */
export function sidebarThreadGroupRowId(groupId: string) {
  return `group:${groupId}`;
}

// Mounted only while renaming, so each rename starts from the current title.
function GroupRenameInput(props: {
  title: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.title);
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const doneRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      doneRef.current = true;
      if (event.key === "Enter") props.onCommit(title);
      else props.onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={title}
      dir="auto"
      aria-label="Group title"
      onChange={(event) => setTitle(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!doneRef.current) props.onCommit(title);
      }}
      className="-mx-1 min-w-0 flex-1 rounded-sm bg-card px-1 text-xs font-medium text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}

/**
 * A sidebar thread group's header. It reads like the Working, Snoozed and Settled shelf
 * headers, with the group's project icon where member rows show theirs. Dragging it
 * reorders groups.
 */
export const SidebarThreadGroupHeader = memo(function SidebarThreadGroupHeader(props: {
  group: SidebarThreadGroup;
  memberCount: number;
  project: ProjectFaviconProject | null;
  className?: string;
  dragging: boolean;
  isDropTarget: boolean;
  isReordering: boolean;
  isRenaming: boolean;
  onToggle: (groupId: string) => void;
  onContextMenu: (
    groupId: string,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  onCommitRename: (groupId: string, title: string) => void;
  onCancelRename: () => void;
  onReorderMove: (groupId: string, clientY: number) => void;
  onReorderEnd: (commit: boolean) => void;
}) {
  const { group, onReorderMove, onReorderEnd } = props;
  const favicon = (
    <span aria-hidden className="flex shrink-0 items-center opacity-40 grayscale">
      {props.project ? <ProjectFavicon project={props.project} className="size-4" /> : null}
    </span>
  );

  const startReorder = (event: ReactPointerEvent) => {
    if (props.isRenaming || !event.isPrimary || event.button !== 0) return;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const document = event.currentTarget.ownerDocument;
    let started = false;
    const suppressClick = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
    };
    const stop = (commit: boolean) => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", keydown, true);
      if (!started) return;
      onReorderEnd(commit);
      // The release lands a click on the header, which would toggle it.
      document.addEventListener("click", suppressClick, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", suppressClick, true), 0);
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!started && Math.abs(moveEvent.clientY - startY) <= REORDER_DISTANCE) return;
      started = true;
      moveEvent.preventDefault();
      onReorderMove(group.id, moveEvent.clientY);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) stop(true);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) stop(false);
    };
    const keydown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") stop(false);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", keydown, true);
  };

  return (
    <SortableSidebarMarker
      marker={`group:${group.id}`}
      data-testid="sidebar-thread-group-header"
      className={cn(
        "relative mx-0.5 h-8 select-none",
        props.isReordering && "opacity-60",
        props.className,
      )}
    >
      {props.isRenaming ? (
        <div className="flex h-8 items-center gap-2.5 px-2">
          {favicon}
          <GroupRenameInput
            title={group.title}
            onCommit={(title) => props.onCommitRename(group.id, title)}
            onCancel={props.onCancelRename}
          />
        </div>
      ) : (
        <CollapsibleSectionHeader
          data-sidebar-row={sidebarThreadGroupRowId(group.id)}
          data-sidebar-thread-group={group.id}
          onClick={() => props.onToggle(group.id)}
          onPointerDown={startReorder}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onContextMenu(
              group.id,
              { x: event.clientX, y: event.clientY },
              contextMenuSourceOf(event),
            );
          }}
          expanded={!group.collapsed}
          tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
          accessory={<span className="font-normal tabular-nums">{props.memberCount}</span>}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {favicon}
            <span className="min-w-0 truncate">{group.title}</span>
          </span>
        </CollapsibleSectionHeader>
      )}
    </SortableSidebarMarker>
  );
});

/** A zero-height marker showing where a dragged group header will land. */
export function SidebarThreadGroupInsertionLine() {
  return (
    <li aria-hidden className="pointer-events-none relative mx-2 h-0 list-none">
      <span className="absolute inset-x-0 -top-px h-0.5 rounded-full bg-primary" />
    </li>
  );
}
