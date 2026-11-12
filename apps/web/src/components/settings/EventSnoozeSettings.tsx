import type { ServerSettings } from "@t3tools/contracts";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function EventSnoozeSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const rules = settings.eventSnoozeRules;
  const jira = settings.jiraSnooze;
  const saveJira = (key: keyof ServerSettings["jiraSnooze"], value: string) => {
    if (jira[key] !== value) update({ jiraSnooze: { [key]: value } });
  };
  return (
    <>
      {(["pullRequestProjects", "jiraProjects"] as const).map((key) => (
        <SettingsRow
          key={key}
          serverScoped
          settingKeys={["eventSnoozeRules"]}
          title={key === "pullRequestProjects" ? "PR event projects" : "Jira event projects"}
          description="Project names or IDs, separated by commas. Leave empty to disable."
          control={
            <Input
              aria-label={
                key === "pullRequestProjects" ? "PR event projects" : "Jira event projects"
              }
              key={rules[key].join(",")}
              defaultValue={rules[key].join(", ")}
              onBlur={(event) => {
                const projects = [
                  ...new Set(
                    event.currentTarget.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  ),
                ];
                update({ eventSnoozeRules: { [key]: projects } });
              }}
            />
          }
        />
      ))}
      <SettingsRow
        serverScoped
        settingKeys={["jiraSnooze"]}
        title="Jira site"
        description="The HTTPS address of your Jira site."
        control={
          <Input
            aria-label="Jira site"
            key={jira.baseUrl}
            defaultValue={jira.baseUrl}
            onBlur={(event) => saveJira("baseUrl", event.currentTarget.value.trim())}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["jiraSnooze"]}
        title="Jira email"
        description="The account used to check for new ticket comments."
        control={
          <Input
            type="email"
            aria-label="Jira email"
            key={jira.email}
            defaultValue={jira.email}
            onBlur={(event) => saveJira("email", event.currentTarget.value.trim())}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["jiraSnooze"]}
        title="Jira API token"
        description="Stored in this environment’s secret store. Only comments your account can read can wake a chat."
        control={
          <Input
            type="password"
            autoComplete="off"
            aria-label="Jira API token"
            key={String(jira.apiToken)}
            defaultValue={typeof jira.apiToken === "string" ? jira.apiToken : ""}
            onBlur={(event) => {
              if (event.currentTarget.value !== event.currentTarget.defaultValue)
                saveJira("apiToken", event.currentTarget.value.trim());
            }}
          />
        }
      />
    </>
  );
}
