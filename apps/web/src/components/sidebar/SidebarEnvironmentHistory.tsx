import { useGT } from "gt-react";
import { CpuIcon, MemoryStickIcon } from "lucide-react";

import { curvePath, smoothCurve } from "../../lib/monotoneCurve";
import { cn } from "../../lib/utils";
import {
  RESOURCE_HISTORY_WINDOW_MS,
  resourceHistorySegments,
  type ResourceHistorySample,
} from "@t3tools/client-runtime/environment-history";

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 24;
const PLOT_TOP = 1;
const PLOT_BOTTOM = VIEW_HEIGHT - 1;

type Metric = "cpuPercent" | "memoryPercent";

function historyPaths(samples: ReadonlyArray<ResourceHistorySample>, metric: Metric, now: number) {
  return resourceHistorySegments(samples, metric, now).flatMap((segment) => {
    const points = segment.map((sample) => ({
      x: Math.min(
        VIEW_WIDTH,
        Math.max(0, VIEW_WIDTH * (1 - (now - sample.observedAt) / RESOURCE_HISTORY_WINDOW_MS)),
      ),
      y: PLOT_BOTTOM - ((sample[metric] ?? 0) / 100) * (PLOT_BOTTOM - PLOT_TOP),
    }));
    const line = curvePath(smoothCurve(points));
    const first = points[0];
    const last = points.at(-1);
    if (line === "" || first === undefined || last === undefined) return [];
    return [
      {
        key: segment[0]?.observedAt ?? 0,
        line,
        area: `${line} L${last.x.toFixed(2)},${VIEW_HEIGHT} L${first.x.toFixed(2)},${VIEW_HEIGHT} Z`,
      },
    ];
  });
}

function HistoryChart({
  label,
  icon: Icon,
  value,
  emptyLabel,
  samples,
  metric,
  now,
  colorClassName,
}: {
  readonly label: string;
  readonly icon: typeof CpuIcon;
  readonly value: string;
  readonly emptyLabel: string;
  readonly samples: ReadonlyArray<ResourceHistorySample>;
  readonly metric: Metric;
  readonly now: number;
  readonly colorClassName: string;
}) {
  const paths = historyPaths(samples, metric, now);
  return (
    <div className="grid gap-0.5">
      <div className="flex items-center gap-1 text-3xs leading-3 text-sidebar-muted-foreground">
        <Icon aria-hidden="true" className="size-2.5" />
        <span>{label}</span>
        <span className="ml-auto font-medium text-sidebar-foreground tabular-nums">{value}</span>
      </div>
      <div className="relative h-6">
        <svg
          aria-hidden="true"
          className={cn("h-full w-full", colorClassName)}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {[PLOT_TOP, VIEW_HEIGHT / 2, PLOT_BOTTOM].map((y) => (
            <line
              key={y}
              x1={0}
              x2={VIEW_WIDTH}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={1}
              className="text-sidebar-border"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {paths.map(({ key, area }) => (
            <path key={key} d={area} fill="currentColor" fillOpacity={0.12} />
          ))}
          {paths.map(({ key, line }) => (
            <path
              key={key}
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {paths.length === 0 ? (
          <span className="absolute inset-0 grid place-items-center text-3xs text-sidebar-muted-foreground">
            {emptyLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Last-minute CPU and RAM charts on a fixed 0–100% scale; gaps stay gaps. */
export function SidebarEnvironmentHistory({
  samples,
  now,
  cpu,
  memory,
  cpuEmptyLabel,
  memoryEmptyLabel,
}: {
  readonly samples: ReadonlyArray<ResourceHistorySample>;
  readonly now: number;
  readonly cpu: string;
  readonly memory: string;
  readonly cpuEmptyLabel: string;
  readonly memoryEmptyLabel: string;
}) {
  const gt = useGT();
  return (
    <div className="grid gap-1.5">
      <HistoryChart
        label={gt("CPU")}
        icon={CpuIcon}
        value={cpu}
        emptyLabel={cpuEmptyLabel}
        samples={samples}
        metric="cpuPercent"
        now={now}
        colorClassName="text-info"
      />
      <HistoryChart
        label={gt("RAM")}
        icon={MemoryStickIcon}
        value={memory}
        emptyLabel={memoryEmptyLabel}
        samples={samples}
        metric="memoryPercent"
        now={now}
        colorClassName="text-primary"
      />
      <div
        aria-hidden="true"
        className="flex justify-between text-3xs leading-3 text-sidebar-muted-foreground tabular-nums"
      >
        <span>{gt("-60s")}</span>
        <span>{gt("-30s")}</span>
        <span>{gt("now")}</span>
      </div>
    </div>
  );
}
