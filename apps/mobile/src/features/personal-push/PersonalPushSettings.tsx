import { useSyncExternalStore } from "react";
import { Linking } from "react-native";
import { useGT } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { AppText } from "../../components/ui/AppText";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  connectPersonalPush,
  disconnectPersonalPush,
  forgetPersonalPush,
  getPersonalPushState,
  refreshPersonalPush,
  setPersonalPushPreview,
  subscribePersonalPush,
} from "./registration";

export function PersonalPushSettings() {
  const gt = useGT();
  const state = useSyncExternalStore(subscribePersonalPush, getPersonalPushState);
  return (
    <SettingsScreen title={gt("Notifications")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4 pb-12"
      >
        <AppText className="text-base text-foreground-muted">
          {gt(
            "Get an alert when a thread finishes or needs your attention. Tap it to open the conversation.",
          )}
        </AppText>
        <SettingsSection title={gt("Agent activity")}>
          {state.configured ? (
            <>
              <SettingsRow
                icon="arrow.clockwise"
                label={gt("Refresh connection")}
                disabled={state.busy}
                onPress={() => {
                  void refreshPersonalPush();
                }}
              />
              <SettingsSwitchRow
                icon="text.bubble"
                label={gt("Response previews")}
                subtitle={gt(
                  "Include the beginning of the response in notifications sent through Apple.",
                )}
                value={state.preview}
                disabled={state.busy}
                onValueChange={(value) => {
                  void setPersonalPushPreview(value);
                }}
              />
              <SettingsRow
                icon="bell.badge"
                label={gt("Disconnect notifications")}
                disabled={state.busy}
                onPress={() =>
                  Dialog.confirm({
                    title: gt("Disconnect notifications"),
                    message: gt("Stop sending alerts to this iPhone?"),
                    confirmText: gt("Disconnect"),
                    onConfirm: () => {
                      void disconnectPersonalPush();
                    },
                  })
                }
              />
            </>
          ) : (
            <SettingsRow
              icon="bell.badge"
              label={gt("Connect notifications")}
              disabled={state.busy}
              onPress={() =>
                Dialog.prompt({
                  title: gt("Connect notifications"),
                  message: gt("Paste the invitation from your notification hub."),
                  initialValue: "",
                  confirmText: gt("Connect"),
                  onConfirm: (value) => {
                    void connectPersonalPush(value);
                  },
                })
              }
            />
          )}
          {state.configured && state.error === "connection" ? (
            <SettingsRow
              icon="xmark.circle.fill"
              label={gt("Forget notification connection")}
              disabled={state.busy}
              onPress={() =>
                Dialog.confirm({
                  title: gt("Forget notification connection"),
                  message: gt(
                    "The hub is unreachable. Forget this connection on your iPhone? Alerts may continue until this device is removed from the old hub.",
                  ),
                  confirmText: gt("Forget"),
                  destructive: true,
                  onConfirm: () => {
                    void forgetPersonalPush();
                  },
                })
              }
            />
          ) : null}
          <SettingsRow
            icon="gearshape"
            label={gt("Open Settings")}
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        </SettingsSection>
        {state.error ? (
          <AppText className="text-base text-foreground-muted">
            {state.error === "permission"
              ? gt("Enable notifications for this app in iPhone Settings.")
              : state.error === "registration"
                ? gt("This notification registration is invalid. Reconnect using a new invitation.")
                : gt("The notification hub could not be reached. Check Tailscale and try again.")}
          </AppText>
        ) : null}
        {state.status ? (
          <SettingsSection title={gt("Environments")}>
            {state.status.environments.map((environment) => (
              <SettingsRow
                key={environment.environmentId}
                icon="desktopcomputer"
                label={environment.name}
                value={environment.connected ? gt("Connected") : gt("Offline")}
              />
            ))}
          </SettingsSection>
        ) : null}
        {state.status?.deliveryError ? (
          <AppText className="text-base text-foreground-muted">
            {gt("Notification delivery needs attention on the hub.")}
          </AppText>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
