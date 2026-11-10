import { useAtomValue } from "@effect/atom-react";
import { Fragment } from "react";
import type { TimestampFormat } from "@t3tools/contracts/settings";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { primaryServerProvidersAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ClaudeAI, CursorIcon, OpenAI } from "../Icons";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  timestampFormat,
  onClick,
}: {
  readonly track: SidebarUsageTrack;
  readonly group: "Personal" | "Sensoneo";
  readonly now: number;
  readonly timestampFormat: TimestampFormat;
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
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${title}: ${details}`}
            onClick={openLimits}
            className="flex h-9 w-full min-w-0 cursor-pointer items-center rounded-sm px-1 text-left outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span
              aria-hidden="true"
              className="flex min-w-0 items-start gap-1.5 text-xs tabular-nums"
            >
              <Icon
                className="mt-0.5 size-3 shrink-0 fill-current!"
                style={{
                  color: group === "Sensoneo" ? SENSONEO_GREEN : "var(--sidebar-foreground)",
                }}
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
                      {track.name !== "Cursor" ? (
                        <span className="h-3 whitespace-nowrap text-3xs leading-3 text-sidebar-muted-foreground">
                          {window.reset === "?" ? "" : window.reset}
                        </span>
                      ) : null}
                    </span>
                  </Fragment>
                ))}
              </span>
            </span>
          </button>
        }
      />
      <TooltipPopup side="top">
        <div className="space-y-1 tabular-nums">
          <div>{title}</div>
          {windows.map((window) => (
            <div key={window.label}>
              <div>
                {window.label}: {window.status}
              </div>
              {track.name !== "Cursor" ? (
                <div className="text-muted-foreground">
                  {window.reset === "Due"
                    ? "Reset due, waiting for refresh"
                    : window.resetsAt && window.reset !== "?"
                      ? `Resets in ${window.reset} (${formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)})`
                      : "Reset time unavailable"}
                </div>
              ) : null}
            </div>
          ))}
          {track.checkedAt ? (
            <div className="text-muted-foreground">
              Last checked {formatUpcomingTimestamp(track.checkedAt, timestampFormat, now)}
            </div>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function SidebarUsageRings({ onClick }: { readonly onClick: () => void }) {
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}Z`);
  const groups = sidebarUsageRings(providers);
  if (groups.personal.length === 0 && groups.sensoneo.length === 0) return null;
  return (
    <SidebarMenuItem className="min-w-0 basis-full group-data-[collapsible=icon]:hidden">
      <div className="grid grid-cols-2 divide-x divide-sidebar-border">
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
                timestampFormat={settings.timestampFormat}
                onClick={onClick}
              />
            ))}
          </div>
        ))}
      </div>
    </SidebarMenuItem>
  );
}
