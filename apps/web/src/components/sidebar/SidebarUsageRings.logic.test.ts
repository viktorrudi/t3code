import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sidebarUsageRings, sidebarUsageReset } from "./SidebarUsageRings.logic";

function provider(
  instanceId: string,
  driver: string,
  overrides: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-10T09:00:00Z",
    models: [],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: "2026-11-10T09:00:00Z",
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 25,
          resetsAt: "2026-11-10T12:00:00Z",
        },
        {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 60,
          resetsAt: "2026-11-13T09:00:00Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("sidebarUsageRings", () => {
  it("groups accounts and selects every requested window in stable order", () => {
    const rings = sidebarUsageRings([
      provider("litellm-sensoneo", "claudeAgent", {
        auth: { status: "authenticated", type: "customEndpoint" },
      }),
      provider("claude-sensoneo", "claudeAgent"),
      provider("codex-secondary", "codex"),
      provider("claudeAgent", "claudeAgent"),
      provider("codex", "codex"),
      provider("cursor", "cursor", {
        usageLimits: {
          checkedAt: "2026-11-10T09:00:00Z",
          windows: [
            { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 80 },
            { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 50 },
            { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 10 },
          ],
        },
      }),
    ]);
    expect(rings.personal.map((track) => track.instanceId)).toEqual(["codex", "claudeAgent"]);
    expect(rings.sensoneo.map((track) => track.instanceId)).toEqual(["claude-sensoneo", "cursor"]);
    expect(rings.personal[0]?.windows.map((window) => window.percent)).toEqual([40]);
    expect(rings.personal[1]?.windows.map((window) => window.percent)).toEqual([75, 40]);
    expect(rings.sensoneo[0]?.windows.map((window) => window.percent)).toEqual([75, 40]);
    expect(rings.sensoneo[1]?.windows.map((window) => [window.label, window.percent])).toEqual([
      ["Cursor Models · Monthly", 90],
      ["Other Models · Monthly", 20],
    ]);
  });

  it.each([
    { auth: { status: "unauthenticated" as const } },
    { usageLimits: undefined },
    {
      usageLimits: {
        checkedAt: "2026-11-10T09:00:00Z",
        windows: [],
        unavailable: { reason: "probeFailed" as const },
      },
    },
  ])("retains unreadable accounts without cached percentages or reset times: %j", (overrides) => {
    const { personal, sensoneo } = sidebarUsageRings([
      provider("claudeAgent", "claudeAgent"),
      provider("claude-sensoneo", "claudeAgent", overrides),
    ]);
    expect(personal[0]?.windows.map((window) => window.percent)).toEqual([75, 40]);
    expect(sensoneo[0]?.windows.map((window) => window.percent)).toEqual([null, null]);
    expect(sensoneo[0]?.windows.map((window) => window.resetsAt)).toEqual([undefined, undefined]);
  });

  it("distinguishes missing and invalid windows from known exhaustion", () => {
    const { personal, sensoneo } = sidebarUsageRings([
      provider("claudeAgent", "claudeAgent", {
        usageLimits: {
          checkedAt: "2026-11-10T09:00:00Z",
          windows: [
            {
              id: "five_hour",
              kind: "session",
              label: "Session",
              usedPercent: 100,
              resetsAt: "2026-11-10T12:00:00Z",
            },
          ],
        },
      }),
      provider("cursor", "cursor", {
        usageLimits: {
          checkedAt: "2026-11-10T09:00:00Z",
          windows: [
            {
              id: "autoPercentUsed",
              kind: "monthly",
              label: "Cursor Models",
              usedPercent: Number.NaN,
            },
          ],
        },
      }),
    ]);
    expect(personal[0]?.windows.map((window) => window.percent)).toEqual([0, null]);
    expect(personal[0]?.windows[0]?.resetsAt).toBe("2026-11-10T12:00:00Z");
    expect(sensoneo[0]?.windows.map((window) => window.percent)).toEqual([null, null]);
  });

  it("omits disabled, missing, and custom-endpoint instances", () => {
    expect(
      sidebarUsageRings([
        provider("codex", "codex", { enabled: false }),
        provider("claudeAgent", "claudeAgent", { enabled: false }),
        provider("claude-sensoneo", "claudeAgent", {
          auth: { status: "authenticated", type: "customEndpoint" },
        }),
        provider("cursor", "cursor", { enabled: false }),
      ]),
    ).toEqual({ personal: [], sensoneo: [] });
  });
});

it("formats reset countdowns without presenting elapsed or missing resets as fresh quota", () => {
  const now = Date.parse("2026-11-10T09:00:00Z");
  expect(sidebarUsageReset("2026-11-10T11:14:00Z", now)).toBe("2h 14m");
  expect(sidebarUsageReset("2026-11-13T14:37:00Z", now)).toBe("3d 5h");
  expect(sidebarUsageReset("2026-11-10T09:00:30Z", now)).toBe("<1m");
  expect(sidebarUsageReset("2026-11-10T08:00:00Z", now)).toBe("Due");
  expect(sidebarUsageReset(undefined, now)).toBe("?");
  expect(sidebarUsageReset("invalid", now)).toBe("?");
});
