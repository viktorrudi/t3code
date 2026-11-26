import { useAtomValue } from "@effect/atom-react";
import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import type { EnvironmentPresentationWithProviders } from "@t3tools/client-runtime/state/presentation";
import {
  EnvironmentId,
  AuthDiagnosticsReadScope,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  sidebarHostMetrics,
  sidebarBattery,
  orderSidebarEnvironments,
} from "@t3tools/client-runtime/environment-status";
import {
  appendResourceHistory,
  EMPTY_RESOURCE_HISTORY,
} from "@t3tools/client-runtime/environment-history";
import { Path, Rect, Svg } from "react-native-svg";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import IconRobot from "@tabler/icons-react-native/IconRobot";
import IconDatabase from "@tabler/icons-react-native/IconDatabase";
import IconBattery from "@tabler/icons-react-native/IconBattery";
import IconBatteryCharging from "@tabler/icons-react-native/IconBatteryCharging";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { formatBytes } from "../../lib/formatBytes";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { useAppActive } from "../../lib/appState";
import { useNowAfter } from "../../lib/clock";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { sessionHasScope, environmentSession } from "../../state/session";
import { jiraThreadAnnotationsAtom } from "../../state/jira";
import { environmentStatusText } from "../connection/environmentStatusText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { SidebarUsageSummary } from "./SidebarUsageSummary";
import { EnvironmentResourceHistory } from "./EnvironmentResourceHistory";

const overviewResource = Atom.family((key: string) =>
  Atom.make((get) => {
    const [id, interval] = JSON.parse(key) as [string, number];
    if (!id) return undefined;
    const environmentId = EnvironmentId.make(id);
    if (
      !sessionHasScope(
        get(environmentSession.sessionStateAtom(environmentId)),
        AuthDiagnosticsReadScope,
      )
    )
      return undefined;
    const query = serverEnvironment.hostResources({ environmentId, input: {} });
    const result = get(query);
    if (!result.waiting && result._tag !== "Initial") {
      const timer = setTimeout(() => get.refresh(query), interval);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return result;
  }),
);

function EnvironmentRow({
  id,
  entry,
  visible,
  expanded,
  onToggle,
}: {
  readonly id: EnvironmentId;
  readonly entry: EnvironmentPresentationWithProviders;
  readonly visible: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const connected = entry.connection.phase === "connected";
  const result = useAtomValue(
    overviewResource(JSON.stringify([visible && connected ? id : "", expanded ? 2000 : 30000])),
  );
  const success =
    result?._tag === "Failure" ? Option.getOrUndefined(result.previousSuccess) : result;
  const snapshot = success?._tag === "Success" ? success.value : null;
  const receivedAt = success?._tag === "Success" ? success.timestamp : 0;
  const now = useNowAfter(receivedAt ? receivedAt + 60000 : null);
  const metrics = sidebarHostMetrics({
    snapshot,
    receivedAt,
    now,
    staleAfterMs: 60000,
    failed: result?._tag === "Failure",
  });
  const [history, setHistory] = useState(EMPTY_RESOURCE_HISTORY);
  const nextHistory =
    result?._tag === "Success"
      ? appendResourceHistory(history, {
          sampledAt: result.value.sampledAt,
          observedAt: result.timestamp,
          cpuPercent: metrics.cpuPercent,
          memoryPercent: metrics.memoryPercent,
        })
      : history;
  if (nextHistory !== history) setHistory(nextHistory);
  const { themeAppearance } = useAppearancePreferences();
  const muted = themeAppearance === "dark" ? "#8b8b90" : "#737378";
  const machine = resolveEnvironmentMachineKind(entry.serverConfig);
  const battery = sidebarBattery(snapshot, machine);
  const Battery = battery?.charging ? IconBatteryCharging : IconBattery;
  const percent = (value: number | null) => (value === null ? "?" : `${value}%`);
  const tickets = useAtomValue(jiraThreadAnnotationsAtom).get(id);
  const status = environmentStatusText(entry.connection, m);
  const label = entry.entry.target.label;
  const loading = result?._tag === "Initial";
  const unavailable = gt("Unavailable");
  const spokenPercent = (value: number | null) => (value === null ? unavailable : `${value}%`);
  const disconnectedStatus =
    entry.connection.phase === "connecting" ||
    entry.connection.phase === "available" ||
    entry.connection.awaitingApproval
      ? connectionStatusTitle(entry.connection, m)
      : gt("Offline");
  const freshness = metrics.stale
    ? gt("Stale")
    : !snapshot && !loading
      ? gt("Statistics unavailable")
      : "";
  const batteryLabel =
    battery === null
      ? ""
      : battery.charging
        ? gt("Battery: {percent}%, charging", { percent: battery.percent })
        : gt("Battery: {percent}%", { percent: battery.percent });
  const accessibilityLabel = connected
    ? [
        gt(
          "{name}: {status}. RAM {memory}, working agents {agents}, free disk {disk}. CPU: {cpu}",
          {
            name: label,
            status,
            memory: spokenPercent(metrics.memoryPercent),
            agents:
              metrics.workingAgentCount === null ? unavailable : String(metrics.workingAgentCount),
            disk:
              metrics.diskAvailableBytes === null
                ? unavailable
                : formatBytes(metrics.diskAvailableBytes),
            cpu: spokenPercent(metrics.cpuPercent),
          },
        ),
        freshness,
        batteryLabel,
        snapshot?.scope === "constrained" ? gt("RAM/CPU include environment limits") : "",
      ]
        .filter(Boolean)
        .join(". ")
    : `${label}: ${disconnectedStatus}`;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel}
        onPress={onToggle}
        className="min-h-11 flex-row flex-wrap items-center gap-x-3 gap-y-1 py-2"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <EnvironmentMachineSymbol
            kind={machine}
            size={16}
            tintColorClassName="text-foreground-muted"
            tintColor={muted}
          />
          <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground">
            {label}
          </Text>
          {battery && connected ? (
            <View className="flex-row items-center gap-1">
              <Battery color={muted} size={12} />
              <Text className="text-[10px] text-foreground-muted">{battery.percent}%</Text>
            </View>
          ) : null}
        </View>
        {connected ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-row items-center gap-1">
              <Svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke={muted}
                strokeWidth={1.8}
                accessible={false}
              >
                <Rect x={2} y={5} width={20} height={12} rx={2} />
                <Path d="M6 9v4m4-4v4m4-4v4m4-4v4M5 17v3m4-3v3m6-3v3m4-3v3" />
              </Svg>
              <Text className="text-xs tabular-nums text-foreground">
                {percent(metrics.memoryPercent)}
              </Text>
            </View>
            {metrics.detailsAvailability !== null && !loading ? (
              <Text className="text-xs text-foreground-muted">
                {metrics.detailsAvailability === "legacy" ? gt("older T3") : unavailable}
              </Text>
            ) : (
              <>
                <View className="flex-row items-center gap-1">
                  <IconRobot size={12} color={muted} />
                  <Text className="text-xs tabular-nums text-foreground">
                    {metrics.workingAgentCount ?? "?"}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <IconDatabase size={12} color={muted} />
                  <Text className="text-xs tabular-nums text-foreground">
                    {metrics.diskAvailableBytes === null
                      ? "?"
                      : formatBytes(metrics.diskAvailableBytes)}
                  </Text>
                </View>
              </>
            )}
            {metrics.stale ? <Text className="text-xs text-warning-foreground">*</Text> : null}
          </View>
        ) : (
          <Text className="text-xs text-foreground-muted">{disconnectedStatus}</Text>
        )}
        <SymbolView name={expanded ? "chevron.up" : "chevron.down"} size={10} tintColor={muted} />
      </Pressable>
      {expanded ? (
        <View className="gap-2 pb-3 pl-6">
          {connected ? (
            <EnvironmentResourceHistory
              samples={nextHistory.samples}
              now={now}
              cpu={percent(metrics.cpuPercent)}
              memory={percent(metrics.memoryPercent)}
              stale={metrics.stale}
            />
          ) : null}
          {!connected || metrics.stale || (!snapshot && !loading) ? (
            <Text className="text-xs text-foreground-muted">
              {!connected
                ? gt("Not connected; power state unknown")
                : metrics.stale
                  ? gt("Stale")
                  : gt("Statistics unavailable")}
            </Text>
          ) : null}
          {tickets?.status === "error" ? (
            <Text className="text-xs text-warning-foreground">
              {gt("Tickets unavailable")}: {tickets.error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.dispatch(
                StackActions.push("SettingsEnvironmentDetail", { environmentId: id }),
              )
            }
            className="min-h-11 flex-row items-center justify-between"
          >
            <Text className="text-xs text-foreground-muted">{gt("Environment settings")}</Text>
            <SymbolView name="chevron.right" size={10} tintColor={muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function EnvironmentOverview({ visible = true }: { readonly visible?: boolean }) {
  const gt = useGT();
  const focused = useIsFocused();
  const foreground = useAppActive();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const [expanded, setExpanded] = useState<EnvironmentId | null>(null);
  const ordered = orderSidebarEnvironments(
    [...presentations].map(([id, entry]) => ({
      environmentId: id,
      connection: entry.connection,
      entry,
    })),
    null,
  );
  if (!presentations.size) return null;
  return (
    <View className="px-4 py-3">
      <SidebarUsageSummary />
      <View className="mt-3 border-t border-border pt-2">
        <Text className="py-2 text-xs font-t3-medium text-foreground-muted">
          {gt("Environments")}
        </Text>
        {ordered.map(({ environmentId: id, entry }) => (
          <EnvironmentRow
            key={id}
            id={id}
            entry={entry}
            visible={visible && focused && foreground}
            expanded={expanded === id}
            onToggle={() => setExpanded((value) => (value === id ? null : id))}
          />
        ))}
      </View>
    </View>
  );
}
