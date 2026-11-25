import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { LIVE_REFRESH_MIN_INTERVAL_MS, useLiveRefresh } from "./useLiveRefresh";

function Probe(props: {
  readonly refresh: () => void;
  readonly viewKey: string;
  readonly enabled?: boolean;
  readonly intervalMs?: number | null;
  readonly refreshOnShow?: boolean;
  readonly minimumIntervalMs?: number;
  readonly refreshWhileIdle?: boolean;
}) {
  useLiveRefresh(props.refresh, {
    key: props.viewKey,
    enabled: props.enabled ?? true,
    ...(props.intervalMs !== undefined ? { intervalMs: props.intervalMs } : {}),
    ...(props.refreshOnShow !== undefined ? { refreshOnShow: props.refreshOnShow } : {}),
    ...(props.minimumIntervalMs !== undefined
      ? { minimumIntervalMs: props.minimumIntervalMs }
      : {}),
    ...(props.refreshWhileIdle !== undefined ? { refreshWhileIdle: props.refreshWhileIdle } : {}),
  });
  return null;
}

describe("useLiveRefresh", () => {
  it("with refreshOnShow, reads on every show unless it read within the floor", async () => {
    const refresh = vi.fn();
    // The first enable reads the clock.
    using _timers = fakeTimers({ now: 1_000_000 });
    const probe = (enabled: boolean) => (
      <Probe refresh={refresh} viewKey="show" enabled={enabled} refreshOnShow intervalMs={null} />
    );
    // A bare hook probe; nothing here navigates.
    await using screen = await render(probe(true), { router: false });
    expect(refresh).toHaveBeenCalledTimes(1);

    await screen.rerender(probe(false));
    await act(() => vi.advanceTimersByTime(LIVE_REFRESH_MIN_INTERVAL_MS - 1));
    await screen.rerender(probe(true));
    expect(refresh).toHaveBeenCalledTimes(1);

    await screen.rerender(probe(false));
    await act(() => vi.advanceTimersByTime(1));
    await screen.rerender(probe(true));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("with intervalMs null, never refreshes on a timer", async () => {
    const periodic = vi.fn();
    const untimed = vi.fn();
    // The interaction clock starts when the first view mounts.
    using _timers = fakeTimers({ now: 1_000_000 });
    await using _screen = await render(
      <>
        <Probe refresh={periodic} viewKey="periodic" intervalMs={60_000} />
        <Probe refresh={untimed} viewKey="untimed" intervalMs={null} />
      </>,
      // A bare hook probe; nothing here navigates.
      { router: false },
    );

    // Past the default 5 minute interval, but inside the 6 minute idle cutoff.
    await act(() => vi.advanceTimersByTime(5.5 * 60_000));

    expect(periodic).toHaveBeenCalledTimes(5);
    expect(untimed).not.toHaveBeenCalled();
  });
  it("allows a visible live view to refresh quickly through idle while retaining other views' defaults", async () => {
    const live = vi.fn();
    const normal = vi.fn();
    using _timers = fakeTimers({ now: 1_000_000 });
    const ui = (enabled = true) => (
      <>
        <Probe
          refresh={live}
          viewKey="fast-live"
          intervalMs={2_000}
          minimumIntervalMs={2_000}
          refreshWhileIdle
          refreshOnShow
          enabled={enabled}
        />
        <Probe refresh={normal} viewKey="normal-floor" intervalMs={2_000} refreshOnShow />
      </>
    );
    // Bare hook probes; neither navigates.
    await using screen = await render(ui(), { router: false });
    expect(live).toHaveBeenCalledTimes(1);
    expect(normal).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(2_000));
    expect(live).toHaveBeenCalledTimes(2);
    expect(normal).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(8_000));
    expect(live).toHaveBeenCalledTimes(6);
    expect(normal).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTime(350_000));
    const normalIdleCount = normal.mock.calls.length;
    const liveIdleCount = live.mock.calls.length;
    await act(() => vi.advanceTimersByTime(10_000));
    expect(normal).toHaveBeenCalledTimes(normalIdleCount);
    expect(live).toHaveBeenCalledTimes(liveIdleCount + 5);
    using visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    const hiddenCount = live.mock.calls.length;
    await act(() => vi.advanceTimersByTime(10_000));
    expect(live).toHaveBeenCalledTimes(hiddenCount);
    expect(normal).toHaveBeenCalledTimes(normalIdleCount);
    visible.mockReturnValue("visible");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(live).toHaveBeenCalledTimes(hiddenCount + 1);
    expect(normal).toHaveBeenCalledTimes(normalIdleCount);
    await screen.rerender(ui(false));
    await act(() => vi.advanceTimersByTime(2_000));
    expect(live).toHaveBeenCalledTimes(hiddenCount + 1);
    await screen.rerender(ui());
    expect(live).toHaveBeenCalledTimes(hiddenCount + 2);
  });
});
