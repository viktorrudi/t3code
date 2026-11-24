import { useAtomValue } from "@effect/atom-react";
import { isManagedSettingPath, type ServerSettingsPatch } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import * as Dialog from "../../../components/ui/Dialog";
import { SecretTextInput } from "../../../components/ui/SecretTextInput";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatEnvironmentQueryError } from "../../../state/query";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsSection } from "./SettingsSection";

export function EventSnoozeSettings({ environment }: { readonly environment: SettingsTarget }) {
  const gt = useGT();
  const { environmentId, serverConfig } = environment;
  const rules = serverConfig.settings.eventSnoozeRules;
  const connection = serverConfig.settings.jiraSnooze;
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<
    Partial<
      Record<"pullRequestProjects" | "jiraProjects" | "baseUrl" | "email" | "apiToken", string>
    >
  >({});
  const [error, setError] = useState<string | null>(null);
  const canEditRules =
    canWrite && !isManagedSettingPath(serverConfig.managedPolicy, "eventSnoozeRules");
  const canEditJira = canWrite && !isManagedSettingPath(serverConfig.managedPolicy, "jiraSnooze");
  const fields = [
    {
      key: "pullRequestProjects",
      label: gt("PR event projects"),
      value: rules.pullRequestProjects.join(", "),
      editable: canEditRules,
    },
    {
      key: "jiraProjects",
      label: gt("Jira event projects"),
      value: rules.jiraProjects.join(", "),
      editable: canEditRules,
    },
    { key: "baseUrl", label: gt("Jira site"), value: connection.baseUrl, editable: canEditJira },
    { key: "email", label: gt("Jira email"), value: connection.email, editable: canEditJira },
  ] as const;

  const save = async (patch: ServerSettingsPatch, clearDraft = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await update({ environmentId, input: { patch } });
      const failure = AsyncResult.isFailure(result)
        ? formatEnvironmentQueryError(result.cause)
        : null;
      setError(failure);
      if (!failure) {
        setDraft((current) => (clearDraft ? {} : { ...current, apiToken: undefined }));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const submit = () => {
    const projectNames = (value: string) => [
      ...new Set(
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    const eventSnoozeRules = {
      ...(canEditRules && draft.pullRequestProjects !== undefined
        ? { pullRequestProjects: projectNames(draft.pullRequestProjects) }
        : {}),
      ...(canEditRules && draft.jiraProjects !== undefined
        ? { jiraProjects: projectNames(draft.jiraProjects) }
        : {}),
    };
    const baseUrl = draft.baseUrl?.trim();
    if (canEditJira && baseUrl !== undefined && !/^https:\/\/[^\s/?#@]+\/?$/i.test(baseUrl)) {
      setError(gt("Enter the HTTPS address of your Jira site."));
      return;
    }
    const apiToken = draft.apiToken?.trim();
    const jiraSnooze = {
      ...(canEditJira && baseUrl !== undefined ? { baseUrl } : {}),
      ...(canEditJira && draft.email !== undefined ? { email: draft.email.trim() } : {}),
      ...(canEditJira && apiToken ? { apiToken } : {}),
    };
    void save(
      {
        ...(Object.keys(eventSnoozeRules).length ? { eventSnoozeRules } : {}),
        ...(Object.keys(jiraSnooze).length ? { jiraSnooze } : {}),
      },
      true,
    );
  };

  return (
    <SettingsSection
      title={gt("Snooze on events")}
      footer={gt("Project names or IDs, separated by commas. Leave empty to disable.")}
    >
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">{environment.label}</Text>
        {fields.map(({ key, label, value, editable }) => (
          <View key={key} className="gap-1.5">
            <Text className="text-sm text-foreground-muted">{label}</Text>
            <AppTextInput
              accessibilityLabel={label}
              className="min-h-11 rounded-xl bg-card px-3"
              value={draft[key] ?? value}
              onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
              autoCapitalize="none"
              autoCorrect={false}
              editable={editable && !busy}
            />
          </View>
        ))}
        <View className="gap-1.5">
          <Text className="text-sm text-foreground-muted">{gt("Jira API token")}</Text>
          <SecretTextInput
            accessibilityLabel={gt("Jira API token")}
            placeholder={connection.apiToken ? gt("Token saved") : gt("Jira API token")}
            value={draft.apiToken ?? ""}
            onChangeText={(apiToken) => setDraft((current) => ({ ...current, apiToken }))}
            editable={canEditJira && !busy}
            onSubmitEditing={() => undefined}
          />
        </View>
        {error ? <Text className="text-sm text-danger-foreground">{error}</Text> : null}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={gt("Save")}
            tone="secondary"
            disabled={busy || (!canEditRules && !canEditJira) || Object.keys(draft).length === 0}
            onPress={submit}
          />
          {connection.apiToken && canEditJira ? (
            <Button
              label={gt("Remove token")}
              tone="secondary"
              disabled={busy}
              onPress={() =>
                Dialog.confirm({
                  title: gt("Remove Jira token?"),
                  confirmText: gt("Remove token"),
                  destructive: true,
                  onConfirm: () => void save({ jiraSnooze: { apiToken: "" } }),
                })
              }
            />
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}
