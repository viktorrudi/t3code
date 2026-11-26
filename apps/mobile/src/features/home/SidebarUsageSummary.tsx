import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { sidebarUsageReset, sidebarUsageRings } from "@t3tools/client-runtime/sidebar-usage";
import { useGT, useMessages } from "gt-react-native";
import { Fragment, useState } from "react";
import { Pressable, View } from "react-native";
import { ProviderIcon } from "../../components/ProviderIcon";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useNowMinuteMs } from "../../lib/clock";
import { cn } from "../../lib/cn";
import { environmentPresentations } from "../../state/presentation";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export function SidebarUsageSummary() {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const now = useNowMinuteMs();
  const { themeAppearance } = useAppearancePreferences();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const [expanded, setExpanded] = useState(false);
  const groups = sidebarUsageRings(
    [...presentations.values()].flatMap((entry) => entry.serverConfig?.providers ?? []),
    m,
  );
  if (!groups.personal.length && !groups.sensoneo.length) return null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Usage")}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row items-center justify-between"
      >
        <Text className="text-xs font-t3-medium text-foreground-muted">{gt("Usage")}</Text>
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={12}
          tintColorClassName="text-foreground-muted"
        />
      </Pressable>
      <View className="flex-row">
        {(["personal", "sensoneo"] as const).map((group) => (
          <View
            key={group}
            className={cn("flex-1", group === "personal" ? "border-r border-border pr-4" : "pl-4")}
          >
            <Text className="mb-1 text-xs text-foreground-muted">
              {group === "personal" ? gt("Personal") : gt("Sensoneo")}
            </Text>
            {groups[group].map((track) => {
              const stale =
                track.checkedAt !== undefined && now - Date.parse(track.checkedAt) > 600_000;
              const color =
                group === "sensoneo"
                  ? "#3fa535"
                  : themeAppearance === "dark"
                    ? "#e5e5e5"
                    : "#171717";
              const details = track.windows
                .map((window, index) => {
                  const reset = sidebarUsageReset(window.resetsAt, now, m);
                  const due = window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now;
                  const resetLabel =
                    track.name === "Cursor" && index > 0
                      ? ""
                      : due
                        ? gt("; reset due, waiting for refresh")
                        : reset === "?"
                          ? gt("; reset time unavailable")
                          : gt("; resets in {time}", { time: reset });
                  return `${window.label}: ${window.status}${resetLabel}`;
                })
                .join(", ");
              return (
                <Pressable
                  key={track.instanceId}
                  accessibilityRole="button"
                  accessibilityLabel={`${group === "personal" ? gt("Personal") : gt("Sensoneo")} · ${track.name}: ${details}${stale ? ` · ${gt("Stale")}` : ""}`}
                  onPress={() => navigation.dispatch(StackActions.push("Usage", { tab: "limits" }))}
                  className="min-h-11 flex-row items-center gap-2 py-1"
                >
                  <ProviderIcon
                    provider={track.name === "Claude" ? "claudeAgent" : track.name.toLowerCase()}
                    size={16}
                    tintColor={color}
                  />
                  <View className="flex-row flex-wrap items-start gap-1">
                    {track.windows.map((window, index) => {
                      const due =
                        window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now;
                      return (
                        <Fragment key={window.label}>
                          {index > 0 ? (
                            <Text className="text-sm text-foreground-muted">/</Text>
                          ) : null}
                          <View>
                            <Text
                              className={cn(
                                "text-sm font-t3-medium tabular-nums text-foreground",
                                (window.percent === null || due || stale) &&
                                  "text-foreground-muted",
                                !due &&
                                  !stale &&
                                  window.percent !== null &&
                                  window.percent <= 20 &&
                                  "text-warning-foreground",
                                !due && !stale && window.percent === 0 && "text-destructive",
                              )}
                            >
                              {window.percent === null ? "?" : `${window.percent}%`}
                            </Text>
                            {expanded && (track.name !== "Cursor" || index === 0) ? (
                              <Text className="text-[10px] tabular-nums text-foreground-muted">
                                {sidebarUsageReset(window.resetsAt, now, m)}
                              </Text>
                            ) : null}
                          </View>
                        </Fragment>
                      );
                    })}
                    {stale ? (
                      <Text className="text-[10px] text-warning-foreground">{gt("Stale")}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
