import { useAtomValue } from "@effect/atom-react";
import { Fragment } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { primaryServerProvidersAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { ClaudeAI, CursorIcon, OpenAI } from "../Icons";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { SidebarMenuItem } from "../ui/sidebar";
import {
  sidebarUsageReset,
  sidebarUsageRings,
  type SidebarUsageTrack,
} from "./SidebarUsageRings.logic";

const SENSONEO_GREEN = "#3fa535";

function UsageIndicator({
  track,
  group,
  now,
  onClick,
}: {
  readonly track: SidebarUsageTrack;
  readonly group: "Personal" | "Sensoneo";
  readonly now: number;
  readonly onClick: () => void;
}) {
  const Icon = track.name === "Codex" ? OpenAI : track.name === "Claude" ? ClaudeAI : CursorIcon;
  const title = `${group} · ${track.name}`;
  const windows = track.windows.map((window) => ({
    ...window,
    reset: sidebarUsageReset(window.resetsAt, now),
  }));
  const details = windows
    .map((window) => {
      const reset =
        track.name === "Cursor"
          ? ""
          : window.reset === "Due"
            ? "; reset due, waiting for refresh"
            : window.reset === "?"
              ? "; reset time unavailable"
              : `; resets in ${window.reset}`;
      return `${window.label}: ${window.status}${reset}`;
    })
    .join(", ");
  const openLimits = () => {
    saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
    onClick();
  };
  return (
    <button
      type="button"
      aria-label={`${title}: ${details}`}
      onClick={openLimits}
      className="flex h-7 w-full min-w-0 cursor-pointer items-center rounded-sm px-1 text-left outline-hidden transition-[height] duration-180 ease-out hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-hover/usage:h-9 group-focus-within/usage:h-9 motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="flex min-w-0 items-start gap-1.5 text-xs tabular-nums">
        <Icon
          className="mt-0.5 size-3 shrink-0 fill-current!"
          style={{ color: group === "Sensoneo" ? SENSONEO_GREEN : "var(--sidebar-foreground)" }}
        />
        <span className="flex items-start gap-1">
          {windows.map((window, index) => (
            <Fragment key={window.label}>
              {index > 0 ? <span className="text-sidebar-muted-foreground/60">/</span> : null}
              <span className="flex flex-col items-start">
                <span
                  className={cn(
                    "font-medium text-sidebar-foreground",
                    (window.percent === null || window.reset === "Due") &&
                      "text-sidebar-muted-foreground",
                    window.reset !== "Due" &&
                      window.percent !== null &&
                      window.percent <= 20 &&
                      "text-warning",
                    window.reset !== "Due" && window.percent === 0 && "text-destructive",
                  )}
                >
                  {window.percent === null ? "?" : `${window.percent}%`}
                </span>
                <span className="h-0 translate-y-1 overflow-hidden whitespace-nowrap text-3xs leading-3 text-sidebar-muted-foreground opacity-0 transition-[height,opacity,transform] duration-180 ease-out group-hover/usage:h-3 group-hover/usage:translate-y-0 group-hover/usage:opacity-100 group-focus-within/usage:h-3 group-focus-within/usage:translate-y-0 group-focus-within/usage:opacity-100 motion-reduce:transition-none">
                  {track.name !== "Cursor" && window.reset !== "?" ? window.reset : ""}
                </span>
              </span>
            </Fragment>
          ))}
        </span>
      </span>
    </button>
  );
}

export function SidebarUsageRings({ onClick }: { readonly onClick: () => void }) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}Z`);
  const groups = sidebarUsageRings(providers);
  if (groups.personal.length === 0 && groups.sensoneo.length === 0) return null;
  return (
    <SidebarMenuItem className="min-w-0 basis-full group-data-[collapsible=icon]:hidden">
      <div
        role="group"
        aria-label="Provider usage remaining"
        className="group/usage grid grid-cols-2 divide-x divide-sidebar-border"
      >
        {(["personal", "sensoneo"] as const).map((group) => (
          <div
            key={group}
            role="group"
            aria-label={`${group === "personal" ? "Personal" : "Sensoneo"} usage remaining`}
            className="grid min-w-0 auto-rows-fr gap-1 px-1 first:pl-0 last:pr-0"
          >
            {groups[group].map((track) => (
              <UsageIndicator
                key={track.instanceId}
                track={track}
                group={group === "personal" ? "Personal" : "Sensoneo"}
                now={now}
                onClick={onClick}
              />
            ))}
          </div>
        ))}
      </div>
    </SidebarMenuItem>
  );
}
