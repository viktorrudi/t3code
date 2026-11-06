import type { ServerProvider } from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";

// This fork keeps Personal on the outer track and Sensoneo on the inner track.
const CLAUDE_INSTANCES = ["claudeAgent", "claude-sensoneo"] as const;

function accountTrack(provider: ServerProvider, kind: "weekly" | "session") {
  const window = provider.usageLimits?.windows.find((window) => window.kind === kind);
  const percent =
    provider.auth.status === "authenticated" &&
    !provider.usageLimits?.unavailable &&
    window &&
    Number.isFinite(window.usedPercent)
      ? remainingPercent(window)
      : null;
  const status =
    percent !== null
      ? `${percent}% left`
      : provider.auth.status === "unauthenticated"
        ? "Signed out"
        : "Unavailable";
  return {
    instanceId: provider.instanceId,
    label: (provider.displayName ?? provider.auth.email ?? "Claude").replace(/^Claude\s+/i, ""),
    accentColor: provider.accentColor,
    percent,
    status,
    signedOut: provider.auth.status === "unauthenticated",
  };
}

export function sidebarUsageRings(providers: readonly ServerProvider[]) {
  const enabled = providers.filter((provider) => provider.enabled);
  const codex =
    enabled.find((provider) => provider.driver === "codex" && provider.instanceId === "codex") ??
    enabled.find((provider) => provider.driver === "codex");
  const claude = CLAUDE_INSTANCES.flatMap((instanceId) => {
    const provider = enabled.find(
      (provider) =>
        provider.instanceId === instanceId &&
        provider.driver === "claudeAgent" &&
        provider.auth.type !== "customEndpoint",
    );
    return provider ? [accountTrack(provider, "session")] : [];
  });
  return {
    codex: codex ? accountTrack(codex, "weekly") : null,
    claude,
  };
}

export type SidebarUsageTrack = ReturnType<typeof accountTrack>;
