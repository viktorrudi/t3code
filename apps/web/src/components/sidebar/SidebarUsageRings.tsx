import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";

import { primaryServerProvidersAtom } from "../../state/server";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { sidebarUsageRings, type SidebarUsageTrack } from "./SidebarUsageRings.logic";

function UsageRing({
  provider,
  tracks,
  onClick,
}: {
  readonly provider: "codex" | "claude";
  readonly tracks: readonly SidebarUsageTrack[];
  readonly onClick: () => void;
}) {
  const title = provider === "codex" ? "Codex · Weekly" : "Claude · 5h";
  const description = tracks
    .map((track) => `${provider === "claude" ? `${track.label} ` : ""}${track.status}`)
    .join(", ");
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
              aria-label={`${title}: ${description}`}
              onClick={openLimits}
              size="icon"
            >
              <svg aria-hidden="true" className="size-[18px] -rotate-90" viewBox="0 0 18 18">
                {tracks.map((track, index) => {
                  const radius = index === 0 ? 7.75 : 5.25;
                  const color =
                    provider === "codex" || track.instanceId === "claudeAgent"
                      ? PROVIDER_PRESENTATION.codex.color
                      : (normalizeProviderAccentColor(track.accentColor) ??
                        PROVIDER_PRESENTATION.claude.color);
                  return (
                    <g key={track.instanceId} fill="none" strokeWidth="1.5">
                      <circle
                        cx="9"
                        cy="9"
                        r={radius}
                        className={track.signedOut ? "stroke-current/30" : "stroke-current/22"}
                        strokeDasharray={track.signedOut ? "1.5 2" : undefined}
                      />
                      {track.percent !== null && track.percent > 0 ? (
                        <circle
                          cx="9"
                          cy="9"
                          r={radius}
                          pathLength="100"
                          stroke={color}
                          strokeLinecap="round"
                          strokeDasharray={track.percent === 100 ? undefined : "100"}
                          strokeDashoffset={track.percent === 100 ? undefined : 100 - track.percent}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">
          <div className="space-y-1 tabular-nums">
            <div>{title}</div>
            {tracks.map((track) => (
              <div
                key={track.instanceId}
                className="flex items-center justify-between gap-4 text-muted-foreground"
              >
                {provider === "claude" ? <span>{track.label}</span> : null}
                <span>{track.status}</span>
              </div>
            ))}
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
      {rings.codex ? <UsageRing provider="codex" tracks={[rings.codex]} onClick={onClick} /> : null}
      {rings.claude.length > 0 ? (
        <UsageRing provider="claude" tracks={rings.claude} onClick={onClick} />
      ) : null}
    </>
  );
}
