import appCss from "../index.css?inline";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("groups threads on drop and keeps their status visible in compact rows", async () => {
  await page.viewport(1400, 900);
  const [first, second, ungrouped] = [
    {
      ...threadWithHistory("group-source", 1),
      title: "A working thread with a long title that will need to truncate",
      shellStatus: "running" as const,
    },
    { ...threadWithHistory("group-target", 1), shellStatus: "idle" as const },
    threadWithHistory("ungrouped", 1),
  ];
  using _environment = installFakeEnvironment([first, second, ungrouped]);
  using _storage = { [Symbol.dispose]: () => localStorage.clear() };
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    sidebarWorkingShelfEnabled: false,
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${second.id}`] }),
  );
  await router.load();
  await using _app = await render(
    <>
      <style>{appCss}</style>
      <AppRoot router={router} />
    </>,
    {
      // AppRoot brings its own router.
      router: false,
    },
  );
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-thread-item="${ENVIRONMENT_ID}:${id}"]`);
  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    });
  // The open thread is the target, so the source's title shows only in the sidebar.
  await expect.element(page.getByText(first.title)).toBeInTheDocument();
  await vi.waitFor(() => expect(row(second.id)).not.toBeNull());
  const source = row(first.id)!.getBoundingClientRect();
  const sourceCenter = source.top + source.height / 2;
  const pointerX = source.x + source.width / 2;
  await act(() => {
    row(first.id)!.dispatchEvent(pointer("pointerdown", pointerX, sourceCenter));
    document.dispatchEvent(pointer("pointermove", pointerX, sourceCenter + 10));
  });
  const target = row(second.id)!.getBoundingClientRect();
  const targetCenter = target.top + target.height / 2;
  await act(() => {
    document.dispatchEvent(pointer("pointermove", pointerX, targetCenter));
    document.dispatchEvent(pointer("pointerup", pointerX, targetCenter));
  });
  // Naming fails against the fake server, so the group keeps the target's title.
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="sidebar-thread-group-header"]')?.textContent ?? "",
    ).toMatch(new RegExp(`${second.title}2$`)),
  );
  expect(
    document.querySelector('[data-testid="sidebar-thread-group-header"]')!.getBoundingClientRect()
      .top,
  ).toBeLessThan(row(ungrouped.id)!.getBoundingClientRect().top);
  const groupedStatus = (id: string, label: string) =>
    page
      .getByTestId("sidebar-row-slim")
      .filter({
        has: page.getByText(new RegExp(`^${label}`)),
      })
      .filter({ hasText: id });
  await expect.element(groupedStatus(first.title, "Working")).toBeVisible();
  await expect.element(groupedStatus(second.title, "Waiting")).toBeVisible();
  expect(JSON.parse(localStorage.getItem("t3code:sidebar:thread-groups:v1") ?? "[]")).toEqual([
    expect.objectContaining({
      title: second.title,
      members: [`${ENVIRONMENT_ID}:${second.id}`, `${ENVIRONMENT_ID}:${first.id}`],
    }),
  ]);
});
