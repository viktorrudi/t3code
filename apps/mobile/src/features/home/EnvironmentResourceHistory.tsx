import {
  RESOURCE_HISTORY_WINDOW_MS,
  resourceHistorySegments,
  type ResourceHistorySample,
} from "@t3tools/client-runtime/environment-history";
import { useGT } from "gt-react-native";
import { View } from "react-native";
import { Line, Path, Svg } from "react-native-svg";
import { AppText as Text } from "../../components/ui/AppText";

export function EnvironmentResourceHistory({
  samples,
  now,
  cpu,
  memory,
  stale,
}: {
  readonly samples: readonly ResourceHistorySample[];
  readonly now: number;
  readonly cpu: string;
  readonly memory: string;
  readonly stale: boolean;
}) {
  const gt = useGT();
  return (
    <View className="gap-2">
      {(["cpuPercent", "memoryPercent"] as const).map((metric) => {
        const segments = resourceHistorySegments(samples, metric, now).filter(
          (segment) => segment.length > 1,
        );
        const color = metric === "cpuPercent" ? "#60a5fa" : "#a78bfa";
        return (
          <View key={metric}>
            <View className="mb-1 flex-row justify-between">
              <Text className="text-[10px] text-foreground-muted">
                {metric === "cpuPercent" ? gt("CPU") : gt("RAM")}
              </Text>
              <Text className="text-[10px] tabular-nums text-foreground">
                {metric === "cpuPercent" ? cpu : memory}
              </Text>
            </View>
            <View className="h-8">
              <Svg
                width="100%"
                height="100%"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
                accessible={false}
              >
                {[1, 12, 23].map((y) => (
                  <Line
                    key={y}
                    x1={0}
                    x2={100}
                    y1={y}
                    y2={y}
                    stroke={color}
                    strokeOpacity={0.12}
                    strokeWidth={0.3}
                  />
                ))}
                {segments.map((segment) => {
                  const points = segment.map((sample) => ({
                    x: Math.max(
                      0,
                      Math.min(
                        100,
                        100 * (1 - (now - sample.observedAt) / RESOURCE_HISTORY_WINDOW_MS),
                      ),
                    ),
                    y: 23 - (sample[metric] ?? 0) * 0.22,
                  }));
                  const first = points[0]!;
                  const last = points[points.length - 1]!;
                  const line = points
                    .map(
                      (point, index) =>
                        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
                    )
                    .join(" ");
                  return (
                    <Path
                      key={segment[0]!.observedAt}
                      d={`${line} L${last.x},24 L${first.x},24 Z`}
                      fill={color}
                      fillOpacity={0.12}
                    />
                  );
                })}
                {segments.map((segment) => (
                  <Path
                    key={segment[0]!.observedAt}
                    d={segment
                      .map(
                        (sample, index) =>
                          `${index === 0 ? "M" : "L"}${Math.max(0, Math.min(100, 100 * (1 - (now - sample.observedAt) / RESOURCE_HISTORY_WINDOW_MS))).toFixed(2)},${(23 - (sample[metric] ?? 0) * 0.22).toFixed(2)}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </Svg>
              {segments.length === 0 ? (
                <View className="absolute inset-0 items-center justify-center">
                  <Text className="text-[10px] text-foreground-muted">
                    {stale ? gt("No recent samples") : gt("Collecting samples")}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      <View className="flex-row justify-between">
        <Text className="text-[10px] text-foreground-muted">{gt("-60s")}</Text>
        <Text className="text-[10px] text-foreground-muted">{gt("-30s")}</Text>
        <Text className="text-[10px] text-foreground-muted">{gt("now")}</Text>
      </View>
    </View>
  );
}
