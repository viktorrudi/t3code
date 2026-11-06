import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sidebarUsageRings } from "./SidebarUsageRings.logic";

function provider(
  instanceId: string,
  driver: string,
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    displayName: instanceId === "claudeAgent" ? "Claude Personal" : "Claude Sensoneo",
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-06T09:00:00Z",
    models: [],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: "2026-11-06T09:00:00Z",
      windows: [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 25 },
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 60 },
      ],
    },
    ...overrides,
  };
}

describe("sidebarUsageRings", () => {
  it("uses Codex weekly and Claude session allowances in stable account order", () => {
    const rings = sidebarUsageRings([
      provider("litellm-sensoneo", "claudeAgent", {
        auth: { status: "authenticated", type: "customEndpoint" },
      }),
      provider("claude-sensoneo", "claudeAgent"),
      provider("codex-secondary", "codex"),
      provider("claudeAgent", "claudeAgent"),
      provider("codex", "codex"),
    ]);
    expect(rings.codex?.instanceId).toBe("codex");
    expect(rings.codex?.percent).toBe(40);
    expect(rings.claude.map((track) => [track.label, track.percent])).toEqual([
      ["Personal", 75],
      ["Sensoneo", 75],
    ]);
  });

  it.each([
    { auth: { status: "unauthenticated" as const }, signedOut: true },
    { usageLimits: undefined, signedOut: false },
    {
      usageLimits: {
        checkedAt: "2026-11-06T09:00:00Z",
        windows: [],
        unavailable: { reason: "probeFailed" as const },
      },
      signedOut: false,
    },
  ])("retains an unreadable account without showing a cached percentage: %j", (testCase) => {
    const { signedOut, ...overrides } = testCase;
    const { claude } = sidebarUsageRings([
      provider("claudeAgent", "claudeAgent"),
      provider("claude-sensoneo", "claudeAgent", overrides),
    ]);
    expect(claude).toHaveLength(2);
    expect(claude[0]?.percent).toBe(75);
    expect(claude[1]?.percent).toBeNull();
    expect(claude[1]?.signedOut).toBe(signedOut);
  });

  it("omits disabled, missing, and custom-endpoint instances", () => {
    expect(
      sidebarUsageRings([
        provider("codex", "codex", { enabled: false }),
        provider("claudeAgent", "claudeAgent", { enabled: false }),
        provider("claude-sensoneo", "claudeAgent", {
          auth: { status: "authenticated", type: "customEndpoint" },
        }),
      ]),
    ).toEqual({ codex: null, claude: [] });
  });
});
