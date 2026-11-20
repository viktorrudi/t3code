import { msg } from "gt-react";
import { m as resolveMessage, type MessageResolver } from "../../i18n/messages";
import type { ServerProvider } from "@t3tools/contracts";
import { CURSOR_USAGE_WINDOWS, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatDuration } from "@t3tools/shared/usageLimitsCopy";

function accountTrack(
  provider: ServerProvider,
  name: "Codex" | "Claude" | "Cursor",
  m: MessageResolver,
) {
  const reported = provider.usageLimits?.windows ?? [];
  const selected =
    name === "Cursor"
      ? CURSOR_USAGE_WINDOWS.filter((window) => window.id !== "totalPercentUsed").map((window) => ({
          label: m(msg("{window} · Monthly", { window: window.label })),
          window: reported.find((reported) => reported.id === window.id),
        }))
      : (name === "Codex" ? (["weekly"] as const) : (["session", "weekly"] as const)).map(
          (kind) => ({
            label: kind === "session" ? "5h" : m(msg("Weekly")),
            window: reported.find((window) => window.kind === kind),
          }),
        );
  const windows = selected.map(({ label, window }) => {
    const percent =
      provider.auth.status === "authenticated" &&
      !provider.usageLimits?.unavailable &&
      window &&
      Number.isFinite(window.usedPercent)
        ? remainingPercent(window)
        : null;
    return {
      label,
      percent,
      status:
        percent !== null
          ? m(msg("{percent}% left", { percent }))
          : provider.auth.status === "unauthenticated"
            ? m(msg("Signed out"))
            : m(msg("Unavailable")),
      resetsAt: percent !== null ? window?.resetsAt : undefined,
    };
  });
  return {
    instanceId: provider.instanceId,
    name,
    windows,
    checkedAt: provider.usageLimits?.checkedAt,
  };
}

export function sidebarUsageRings(
  providers: readonly ServerProvider[],
  m: MessageResolver = resolveMessage,
) {
  const enabled = providers.filter(
    (provider) => provider.enabled && provider.auth.type !== "customEndpoint",
  );
  const codex =
    enabled.find((provider) => provider.driver === "codex" && provider.instanceId === "codex") ??
    enabled.find((provider) => provider.driver === "codex");
  const personal = enabled.find(
    (provider) => provider.driver === "claudeAgent" && provider.instanceId === "claudeAgent",
  );
  const sensoneo = enabled.find(
    (provider) => provider.driver === "claudeAgent" && provider.instanceId === "claude-sensoneo",
  );
  const cursor =
    enabled.find((provider) => provider.driver === "cursor" && provider.instanceId === "cursor") ??
    enabled.find((provider) => provider.driver === "cursor");
  return {
    personal: [
      ...(codex ? [accountTrack(codex, "Codex", m)] : []),
      ...(personal ? [accountTrack(personal, "Claude", m)] : []),
    ],
    sensoneo: [
      ...(sensoneo ? [accountTrack(sensoneo, "Claude", m)] : []),
      ...(cursor ? [accountTrack(cursor, "Cursor", m)] : []),
    ],
  };
}

export function sidebarUsageReset(
  resetsAt: string | undefined,
  now: number,
  m: MessageResolver = resolveMessage,
): string {
  const reset = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  if (!Number.isFinite(reset)) return "?";
  if (reset <= now) return m(msg("Due"));
  const days = Math.floor((reset - now) / 86_400_000);
  return days > 0 ? `${days}d` : reset - now < 60_000 ? "<1m" : formatDuration(reset - now, m);
}

export type SidebarUsageTrack = ReturnType<typeof accountTrack>;
