import type { ServerProvider } from "@t3tools/contracts";
import {
  CURSOR_USAGE_WINDOWS,
  formatDuration,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

function accountTrack(provider: ServerProvider, name: "Codex" | "Claude" | "Cursor") {
  const reported = provider.usageLimits?.windows ?? [];
  const selected =
    name === "Cursor"
      ? CURSOR_USAGE_WINDOWS.filter((window) => window.id !== "totalPercentUsed").map((window) => ({
          label: `${window.label} · Monthly`,
          window: reported.find((reported) => reported.id === window.id),
        }))
      : (name === "Codex" ? (["weekly"] as const) : (["session", "weekly"] as const)).map(
          (kind) => ({
            label: kind === "session" ? "5h" : "Weekly",
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
          ? `${percent}% left`
          : provider.auth.status === "unauthenticated"
            ? "Signed out"
            : "Unavailable",
      resetsAt: percent !== null && name !== "Cursor" ? window?.resetsAt : undefined,
    };
  });
  return {
    instanceId: provider.instanceId,
    name,
    windows,
    checkedAt: provider.usageLimits?.checkedAt,
  };
}

export function sidebarUsageRings(providers: readonly ServerProvider[]) {
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
      ...(codex ? [accountTrack(codex, "Codex")] : []),
      ...(personal ? [accountTrack(personal, "Claude")] : []),
    ],
    sensoneo: [
      ...(sensoneo ? [accountTrack(sensoneo, "Claude")] : []),
      ...(cursor ? [accountTrack(cursor, "Cursor")] : []),
    ],
  };
}

export function sidebarUsageReset(resetsAt: string | undefined, now: number): string {
  const reset = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  if (!Number.isFinite(reset)) return "?";
  if (reset <= now) return "Due";
  return reset - now < 60_000 ? "<1m" : formatDuration(reset - now);
}

export type SidebarUsageTrack = ReturnType<typeof accountTrack>;
