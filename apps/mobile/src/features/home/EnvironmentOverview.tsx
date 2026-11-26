import { useAtomValue } from "@effect/atom-react";
import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import { EnvironmentId, AuthDiagnosticsReadScope } from "@t3tools/contracts";
import { sidebarHostMetrics, sidebarBattery } from "@t3tools/client-runtime/environment-status";
import { collectLimitAccounts, remainingPercent, paceOf } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { formatBytes } from "../../lib/formatBytes";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useAppActive } from "../../lib/appState";
import { useNowMinuteMs } from "../../lib/clock";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { sessionHasScope, environmentSession } from "../../state/session";
import { jiraThreadAnnotationsAtom } from "../../state/jira";
import { environmentStatusText } from "../connection/environmentStatusText";

const overviewResources = Atom.family((ids: string) =>
  Atom.make((get) => {
    const evaluatedAt = Date.now();
    const permittedIds = (ids ? ids.split("\n") : []).filter((id) =>
      sessionHasScope(
        get(environmentSession.sessionStateAtom(EnvironmentId.make(id))),
        AuthDiagnosticsReadScope,
      ),
    );
    const queries = permittedIds.map((id) =>
      serverEnvironment.hostResources({ environmentId: EnvironmentId.make(id), input: {} }),
    );
    const results = queries.map((query) => get(query));
    if (queries.length) {
      const timer = setTimeout(() => {
        for (const query of queries) get.refresh(query);
        get.refreshSelf();
      }, 30_000);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return { evaluatedAt, results: new Map(permittedIds.map((id, index) => [id, results[index]])) };
  }),
);

export function EnvironmentOverview({ visible = true }: { readonly visible?: boolean }) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const active = useIsFocused();
  const foreground = useAppActive();
  const now = useNowMinuteMs();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const tickets = useAtomValue(jiraThreadAnnotationsAtom);
  const ids =
    visible && active && foreground
      ? [...presentations]
          .filter(([, entry]) => entry.connection.phase === "connected")
          .map(([id]) => id)
          .sort()
          .join("\n")
      : "";
  const resources = useAtomValue(overviewResources(ids));
  const accounts = collectLimitAccounts(presentations);
  if (presentations.size === 0) return null;
  return (
    <View className="gap-5 px-4 py-5">
      <View className="gap-2">
        <Text className="text-sm font-t3-medium text-foreground-muted">{gt("Usage")}</Text>
        {accounts.map((account) => (
          <Pressable
            key={account.key}
            accessibilityRole="button"
            onPress={() => navigation.dispatch(StackActions.push("Usage", { tab: "limits" }))}
            className="min-h-11 gap-1 rounded-xl bg-card px-3 py-2"
          >
            <View className="flex-row items-center gap-2">
              <ProviderIcon provider={account.driver} size={18} />
              <Text className="flex-1 text-sm font-t3-medium text-foreground">
                {account.displayName ?? account.driver}
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-x-3 gap-y-1">
              {account.limits.windows
                .filter(
                  (window) =>
                    account.driver !== "cursor" ||
                    window.id !== "totalPercentUsed" ||
                    !account.limits.windows.some(
                      (candidate) => candidate.id === "autoPercentUsed",
                    ) ||
                    !account.limits.windows.some((candidate) => candidate.id === "apiPercentUsed"),
                )
                .map((window) => (
                  <Text key={window.id} className="text-xs tabular-nums text-foreground-muted">
                    {window.label}: {gt("{percent}% left", { percent: remainingPercent(window) })}
                    {paceOf(window, now) === "ahead"
                      ? ` · ${gt("Ahead of pace")}`
                      : paceOf(window, now) === "under"
                        ? ` · ${gt("Under pace")}`
                        : paceOf(window, now) === "on"
                          ? ` · ${gt("On pace")}`
                          : ""}
                  </Text>
                ))}
            </View>
            {now - Date.parse(account.limits.checkedAt) > 10 * 60_000 ? (
              <Text className="text-xs text-warning-foreground">
                {gt("Last updated {time}", {
                  time: new Date(account.limits.checkedAt).toLocaleTimeString(),
                })}
              </Text>
            ) : null}
          </Pressable>
        ))}
        {accounts.length === 0 ? (
          <Text className="text-xs text-foreground-muted">{gt("Usage unavailable")}</Text>
        ) : null}
      </View>
      <View className="gap-2">
        <Text className="text-sm font-t3-medium text-foreground-muted">{gt("Environments")}</Text>
        {[...presentations].map(([id, entry]) => {
          const result = resources.results.get(id);
          const success =
            result?._tag === "Failure" ? Option.getOrUndefined(result.previousSuccess) : result;
          const snapshot = result ? AsyncResult.getOrElse(result, () => null) : null;
          const metrics = sidebarHostMetrics({
            snapshot,
            receivedAt: success?._tag === "Success" ? success.timestamp : 0,
            now: resources.evaluatedAt,
            staleAfterMs: 60_000,
            failed: result?._tag === "Failure",
          });
          const annotation = tickets.get(id);
          const machine = resolveEnvironmentMachineKind(entry.serverConfig);
          const battery = sidebarBattery(snapshot, machine);
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              className="min-h-11 gap-1 rounded-xl bg-card px-3 py-2"
              onPress={() =>
                navigation.dispatch(
                  StackActions.push("SettingsEnvironmentDetail", { environmentId: id }),
                )
              }
            >
              <View className="flex-row items-center gap-2">
                <EnvironmentMachineSymbol
                  kind={machine}
                  size={18}
                  tintColorClassName="text-foreground-muted"
                />
                <Text className="flex-1 text-sm font-t3-medium text-foreground">
                  {entry.entry.target.label}
                </Text>
              </View>
              <Text className="text-xs text-foreground-muted">
                {environmentStatusText(entry.connection, m)}
              </Text>
              {snapshot ? (
                <Text className="text-xs tabular-nums text-foreground-muted">
                  {gt("RAM {memory} · CPU {cpu} · Working {agents}", {
                    memory:
                      metrics.memoryPercent === null
                        ? gt("Unavailable")
                        : `${metrics.memoryPercent}%`,
                    cpu: metrics.cpuPercent === null ? gt("Unavailable") : `${metrics.cpuPercent}%`,
                    agents: metrics.workingAgentCount ?? gt("Unavailable"),
                  })}
                  {metrics.stale ? ` · ${gt("Stale")}` : ""}
                </Text>
              ) : entry.connection.phase === "connected" ? (
                <Text className="text-xs text-foreground-muted">
                  {gt("Statistics unavailable")}
                </Text>
              ) : null}
              {metrics.diskAvailableBytes !== null ? (
                <Text className="text-xs text-foreground-muted">
                  {gt("Disk free: {size}", { size: formatBytes(metrics.diskAvailableBytes) })}
                </Text>
              ) : null}
              {battery ? (
                <Text className="text-xs text-foreground-muted">
                  {battery.charging
                    ? gt("Battery: {percent}%, charging", { percent: battery.percent })
                    : gt("Battery: {percent}%", { percent: battery.percent })}
                </Text>
              ) : null}
              {annotation?.status === "error" ? (
                <Text className="text-xs text-warning-foreground">
                  {gt("Tickets unavailable")}: {annotation.error}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
