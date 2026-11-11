import type { ServerProvider } from "@t3tools/contracts";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { SidebarUsageRings } from "./SidebarUsageRings";
import { primaryServerProvidersAtom } from "../../state/server";

const mocks = vi.hoisted(() => ({ providers: [] as ServerProvider[] }));
vi.mock("@effect/atom-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@effect/atom-react")>();
  return {
    ...original,
    useAtomValue: (...args: Parameters<typeof original.useAtomValue>) =>
      args[0] === primaryServerProvidersAtom ? mocks.providers : original.useAtomValue(...args),
  };
});
vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-11-10T09:00" }));

function setup() {
  mocks.providers = (
    [
      ["codex", "codex"],
      ["claudeAgent", "claudeAgent"],
      ["claude-sensoneo", "claudeAgent"],
      ["cursor", "cursor"],
    ] as const
  ).map(([instanceId, driver]): ServerProvider => ({
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
          id: "session",
          kind: "session",
          label: "5h",
          usedPercent: 25,
          resetsAt: "2026-11-10T11:14:00Z",
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 60,
          resetsAt: "2026-11-13T14:37:00Z",
        },
        { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 10 },
        { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 20 },
      ],
    },
  }));
}

it("reveals inline reset timers together on section hover and keyboard focus", async () => {
  setup();
  await using screen = await render(<SidebarUsageRings onClick={vi.fn()} />);
  const section = screen.getByRole("group", { name: "Provider usage remaining", exact: true });
  const codex = screen
    .getByRole("button", { name: /^Personal · Codex:/ })
    .getByText("3d", { exact: true });
  const personal = screen
    .getByRole("button", { name: /^Personal · Claude:/ })
    .getByText("2h 14m", { exact: true });
  const sensoneo = screen
    .getByRole("button", { name: /^Sensoneo · Claude:/ })
    .getByText("3d", { exact: true });
  await expect.element(codex).not.toBeVisible();
  await userEvent.hover(section);
  await expect.element(codex).toBeVisible();
  await expect.element(personal).toBeVisible();
  await expect.element(sensoneo).toBeVisible();
  await expect.element(page.getByText("Personal · Codex", { exact: true })).not.toBeInTheDocument();
  await userEvent.unhover(section);
  await expect.element(codex).not.toBeVisible();
  await userEvent.tab();
  await expect.element(codex).toBeVisible();
  await expect.element(sensoneo).toBeVisible();
});
