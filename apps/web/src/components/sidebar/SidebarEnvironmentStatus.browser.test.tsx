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
  setOpen: (_open: boolean) => {},
  read: (_id: string): AsyncResult.AsyncResult<HostResourcesSnapshot, string> =>
    AsyncResult.initial(),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: mocks.environments }),
}));
vi.mock("../../state/primaryEnvironment", () => ({
  localEnvironmentIdAtom: Atom.make(EnvironmentId.make("primary")),
}));
vi.mock("../../state/clientHostEnvironment", () => ({
  clientHostEnvironmentAtom: Atom.family(() => Atom.make(true)),
}));
vi.mock("../ui/sidebar", () => ({
  SidebarMenuItem: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <li className={className}>{children}</li>
  ),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({
    isMobile: false,
    openMobile: false,
    state: mocks.sidebarState,
    setOpen: (open: boolean) => mocks.setOpen(open),
  }),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    hostResources: Atom.family(({ environmentId }: { environmentId: string }) =>
      Atom.make(() => mocks.read(environmentId)),
    ),
  },
}));

function environment(
  id: string,
  phase: "connected" | "offline" | "connecting",
): EnvironmentPresentation {
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
    environment("legacy-peer", "connected"),
  ];
  const reads = vi.fn((id: string) =>
    id === "older-peer"
      ? AsyncResult.fail("Unsupported method")
      : AsyncResult.success({
          sampledAt: 123,
          ...(id === "legacy-peer"
            ? {}
            : {
                workingAgentCount: 2,
                disk: { scope: "t3-data-filesystem" as const, availableBytes: 25 * 1024 ** 3 },
              }),
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
  const primary = screen.getByLabelText(
    /^primary · This computer: Connected\. RAM 75%, working agents 2, free disk 25.0 GB\. CPU: 25%/,
  );
  const offline = screen.getByLabelText("rudipc: Offline", { exact: true });
  await expect.element(primary).toBeVisible();
  await expect.element(offline).toBeVisible();
  const group = screen.container.querySelector<HTMLElement>(
    '[aria-label="Environment statistics"]',
  )!;
  expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
  expect(new Set(reads.mock.calls.map(([id]) => id))).toEqual(
    new Set(["legacy-peer", "older-peer", "primary"]),
  );
  await expect
    .element(
      screen.getByLabelText(
        /^legacy-peer: Connected\. RAM 75%, working agents Unavailable, free disk Unavailable/,
      ),
    )
    .toBeVisible();
  const details = (name: string) => page.getByRole("group", { name: `${name} details` });
  await userEvent.hover(primary);
  await expect.element(details("primary · This computer")).toBeVisible();
  await expect.element(page.getByText("Working agents: 2 (this T3 server)")).toBeVisible();
  await expect.element(page.getByText("Collecting samples").first()).toBeVisible();
  await userEvent.hover(page.getByText("Working agents: 2 (this T3 server)"));
  await expect.element(details("primary · This computer")).toBeVisible();
  await userEvent.unhover(primary);
  await expect.element(details("primary · This computer")).not.toBeInTheDocument();
  await userEvent.click(primary);
  await userEvent.unhover(primary);
  await expect.element(primary).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(primary);
  await userEvent.unhover(primary);
  await expect.element(primary).toHaveAttribute("aria-expanded", "false");
  await userEvent.tab();
  await userEvent.tab({ shift: true });
  await expect.element(primary).toHaveFocus();
  await expect.element(details("primary · This computer")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(details("primary · This computer")).not.toBeInTheDocument();
  await userEvent.tab();
  await expect.element(screen.getByLabelText(/^older-peer: Connected/)).toHaveFocus();
  await expect.element(page.getByText("Statistics unavailable")).toBeVisible();
  await expect.element(details("primary · This computer")).not.toBeInTheDocument();
  await userEvent.tab();
  await expect
    .element(page.getByText("Working agents and free disk need a newer T3 server."))
    .toBeVisible();
  await userEvent.tab();
  await expect.element(offline).toHaveFocus();
  await expect.element(page.getByText("Not connected; power state unknown")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(details("rudipc")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(details("rudipc")).not.toBeInTheDocument();

  mocks.sidebarState = "collapsed";
  const setOpen = vi.fn();
  mocks.setOpen = setOpen;
  await screen.rerender(ui());
  await userEvent.click(screen.getByRole("button", { name: /^primary · This computer:/ }));
  expect(setOpen).toHaveBeenCalledWith(true);
  await expect.element(details("primary · This computer")).not.toBeInTheDocument();
  using _timers = fakeTimers();
  const collapsedCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(reads).toHaveBeenCalledTimes(collapsedCount);
  mocks.sidebarState = "expanded";
  await screen.rerender(ui());
  await act(() => vi.advanceTimersByTimeAsync(200));
  const { serverEnvironment } = await import("../../state/server");
  await act(() =>
    registry.refresh(
      serverEnvironment.hostResources({ environmentId: EnvironmentId.make("primary"), input: {} }),
    ),
  );
  const pollCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(1_800));
  expect(reads.mock.calls.length).toBe(pollCount + 3);
  expect(reads.mock.calls.some(([id]) => id === "rudipc")).toBe(false);

  mocks.read = (id) => {
    const result = reads(id);
    return id === "primary" && result._tag === "Success"
      ? AsyncResult.success(result.value, { waiting: true })
      : result;
  };
  await act(() =>
    registry.refresh(
      serverEnvironment.hostResources({ environmentId: EnvironmentId.make("primary"), input: {} }),
    ),
  );
  const pendingReads = reads.mock.calls.filter(([id]) => id === "primary").length;
  const otherReads = reads.mock.calls.filter(([id]) => id === "legacy-peer").length;
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(reads.mock.calls.filter(([id]) => id === "primary")).toHaveLength(pendingReads);
  expect(reads.mock.calls.filter(([id]) => id === "legacy-peer")).toHaveLength(otherReads + 2);
  mocks.read = reads;
  await act(() =>
    registry.refresh(
      serverEnvironment.hostResources({ environmentId: EnvironmentId.make("primary"), input: {} }),
    ),
  );

  using visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  const hiddenCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads).toHaveBeenCalledTimes(hiddenCount);
  visible.mockReturnValue("visible");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.element(primary).toBeVisible();

  mocks.environments = [environment("primary", "connecting"), environment("rudipc", "offline")];
  await screen.rerender(ui());
  await expect
    .element(screen.getByLabelText("primary · This computer: Connecting...", { exact: true }))
    .toBeVisible();
  const disconnectedCount = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads).toHaveBeenCalledTimes(disconnectedCount);
  mocks.environments = [environment("primary", "connected"), environment("rudipc", "offline")];
  await screen.rerender(ui());
  await expect.element(primary).toBeVisible();
  expect(reads.mock.calls.length).toBeGreaterThan(disconnectedCount);
  const beforeIdle = reads.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(7 * 60_000));
  await expect.element(primary).toBeVisible();
  expect(primary.element().getAttribute("aria-label")).not.toContain("Stale");
  expect(reads.mock.calls.length).toBeGreaterThan(beforeIdle);
});
