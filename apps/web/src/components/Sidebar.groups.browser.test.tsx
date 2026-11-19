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

it("groups a thread rested on another, and stores the group for the next load", async () => {
  await page.viewport(1400, 900);
  const [first, second] = [
    threadWithHistory("group-source", 1),
    threadWithHistory("group-target", 1),
  ];
  using _environment = installFakeEnvironment([first, second]);
  using _storage = { [Symbol.dispose]: () => localStorage.clear() };
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${second.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
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
  const target = row(second.id)!.getBoundingClientRect();
  const sourceCenter = source.top + source.height / 2;
  const targetCenter = target.top + target.height / 2;
  await act(() => {
    row(first.id)!.dispatchEvent(pointer("pointerdown", source.x + 20, sourceCenter));
    document.dispatchEvent(pointer("pointermove", source.x + 20, sourceCenter + 10));
    document.dispatchEvent(pointer("pointermove", source.x + 20, targetCenter));
  });
  // Resting on the row arms grouping, which the dragged row announces.
  await expect.element(page.getByRole("status").filter({ hasText: /^Group$/ })).toBeVisible();
  await act(() => document.dispatchEvent(pointer("pointerup", source.x + 20, targetCenter)));
  // Naming fails against the fake server, so the group keeps the target's title.
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="sidebar-thread-group-header"]')?.textContent,
    ).toMatch(new RegExp(`${second.title}2$`)),
  );
  expect(JSON.parse(localStorage.getItem("t3code:sidebar:thread-groups:v1") ?? "[]")).toEqual([
    expect.objectContaining({
      title: second.title,
      members: [`${ENVIRONMENT_ID}:${second.id}`, `${ENVIRONMENT_ID}:${first.id}`],
    }),
  ]);
});
