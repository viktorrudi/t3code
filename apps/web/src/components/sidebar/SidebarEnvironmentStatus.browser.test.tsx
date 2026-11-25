import { EnvironmentId, type HostResourcesSnapshot } from "@t3tools/contracts";
import { PrimaryConnectionTarget } from "@t3tools/client-runtime/connection";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { RegistryContext } from "@effect/atom-react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import * as Option from "effect/Option";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";
import type { EnvironmentPresentation } from "../../state/environments";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarEnvironmentStatus } from "./SidebarEnvironmentStatus";

const mocks = vi.hoisted(() => ({
  environments: [] as EnvironmentPresentation[],
  sidebarState: "expanded",
  read: (_id: string): AsyncResult.AsyncResult<HostResourcesSnapshot, string> =>
    AsyncResult.initial(),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: mocks.environments }),
}));
vi.mock("../ui/sidebar", () => ({
  SidebarMenuItem: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <li className={className}>{children}</li>
  ),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false, openMobile: false, state: mocks.sidebarState }),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    hostResources: Atom.family(({ environmentId }: { environmentId: string }) =>
      Atom.make(() => mocks.read(environmentId)),
    ),
  },
}));

function environment(id: string, phase: "connected" | "offline"): EnvironmentPresentation {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    displayUrl: null,
    relayManaged: false,
    entry: {
      target: new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make(id),
        label: id,
        httpBaseUrl: "http://localhost",
        wsBaseUrl: "ws://localhost/ws",
      }),
      profile: Option.none(),
      enabled: true,
    },
    connection: { phase, error: null, traceId: null },
    serverConfig: null,
    refusedRouteIds: [],
  };
}

it("polls only visible connected hosts, resumes after reconnect, and exposes details to focus and hover", async () => {
  mocks.sidebarState = "expanded";
  mocks.environments = [
    environment("primary", "connected"),
    environment("rudipc", "offline"),
    environment("older-peer", "connected"),
  ];
  const reads = vi.fn((id: string) =>
    id === "older-peer"
      ? AsyncResult.fail("Unsupported method")
      : AsyncResult.success({
          sampledAt: 123,
          cpuUtilization: 0.25,
          cpuCount: 8,
          totalMemoryBytes: 16 * 1024 ** 3,
          availableMemoryBytes: 4 * 1024 ** 3,
        }),
  );
  mocks.read = reads;
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  const ui = () => (
    <RegistryContext value={registry}>
      <SidebarProvider>
        <div className="w-52">
          <SidebarEnvironmentStatus />
        </div>
      </SidebarProvider>
    </RegistryContext>
  );
  await using screen = await render(ui());
  const primary = screen.getByLabelText(/^primary: Connected\. CPU 25%, memory 75%/);
  const offline = screen.getByLabelText("rudipc: Offline", { exact: true });
  await expect.element(primary).toBeVisible();
  await expect.element(offline).toBeVisible();
  const group = screen.container.querySelector<HTMLElement>(
    '[aria-label="Environment statistics"]',
  )!;
  expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
  expect(reads.mock.calls.map(([id]) => id)).toEqual(["older-peer", "primary"]);
  await userEvent.hover(primary);
  await expect.element(page.getByText("Memory used: 12.0 GB / 16.0 GB")).toBeVisible();
  await userEvent.unhover(primary);
  await userEvent.tab();
  await expect.element(primary).toHaveFocus();
  await expect.element(page.getByText("CPU cores: 8")).toBeVisible();
  await userEvent.tab();
  await expect.element(offline).toHaveFocus();
  await expect.element(page.getByText("Not connected; power state unknown")).toBeVisible();

  mocks.sidebarState = "collapsed";
  await screen.rerender(ui());
  using _timers = fakeTimers();
  mocks.sidebarState = "expanded";
  await screen.rerender(ui());
  const pollCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(reads.mock.calls.length).toBe(pollCount + 2);
  expect(reads.mock.calls.some(([id]) => id === "rudipc")).toBe(false);

  using visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  const hiddenCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads).toHaveBeenCalledTimes(hiddenCount);
  visible.mockReturnValue("visible");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.element(primary).toBeVisible();

  mocks.environments = [environment("primary", "offline"), environment("rudipc", "offline")];
  await screen.rerender(ui());
  const disconnectedCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads).toHaveBeenCalledTimes(disconnectedCount);
  mocks.environments = [environment("primary", "connected"), environment("rudipc", "offline")];
  await screen.rerender(ui());
  await expect.element(primary).toBeVisible();
  expect(reads.mock.calls.length).toBeGreaterThan(disconnectedCount);
  await act(() => vi.advanceTimersByTimeAsync(7 * 60_000));
  await expect.element(screen.getByLabelText(/^primary: Connected\..*Stale/)).toBeVisible();
});
