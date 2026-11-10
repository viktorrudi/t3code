import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";

import { primaryServerProvidersAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { ClaudeAI, OpenAI } from "../Icons";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { sidebarUsageRings, type SidebarUsageTrack } from "./SidebarUsageRings.logic";

function UsageIndicator({
  provider,
  track,
  onClick,
}: {
  readonly provider: "codex" | "claude";
  readonly track: SidebarUsageTrack;
  readonly onClick: () => void;
}) {
  const title = provider === "codex" ? "Codex · Weekly" : `Claude ${track.label} · 5h`;
  const Icon = provider === "codex" ? OpenAI : ClaudeAI;
  const color =
    provider === "codex" || track.instanceId === "claudeAgent"
      ? PROVIDER_PRESENTATION.codex.color
      : (normalizeProviderAccentColor(track.accentColor) ?? PROVIDER_PRESENTATION.claude.color);
  const openLimits = () => {
    saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
    onClick();
  };
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={`${title}: ${track.status}`}
              onClick={openLimits}
              size="icon"
            >
              <span aria-hidden="true" className="relative size-7 shrink-0">
                <Icon
                  className={cn(
                    "absolute top-0.5 left-0.5 size-5 fill-current",
                    track.percent === null && "opacity-40",
                  )}
                  style={{ color }}
                />
                <span
                  className={cn(
                    "absolute right-0 bottom-0 min-w-5 rounded-sm bg-sidebar px-0.5 text-center text-3xs font-semibold leading-3.5 text-sidebar-foreground tabular-nums ring-1 ring-sidebar",
                    track.percent === null && "text-sidebar-muted-foreground",
                    track.percent !== null && track.percent <= 20 && "text-warning",
                    track.percent === 0 && "text-destructive",
                  )}
                >
                  {track.percent === null ? "?" : `${track.percent}%`}
                </span>
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">
          <div className="space-y-1 tabular-nums">
            <div>{title}</div>
            <div className="text-muted-foreground">{track.status}</div>
          </div>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export function SidebarUsageRings({ onClick }: { readonly onClick: () => void }) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const rings = sidebarUsageRings(providers);
  return (
    <>
      {rings.codex ? (
        <UsageIndicator provider="codex" track={rings.codex} onClick={onClick} />
      ) : null}
      {rings.claude.map((track) => (
        <UsageIndicator key={track.instanceId} provider="claude" track={track} onClick={onClick} />
      ))}
    </>
  );
}
