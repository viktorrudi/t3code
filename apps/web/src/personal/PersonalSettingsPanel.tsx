import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { ChatWidthSettingsRow } from "../components/settings/ChatWidthSettingsRow";
import { Switch } from "../components/ui/switch";
import { useAtSearchMode } from "./personalSettings";

export function PersonalSettingsPanel() {
  const [mode, setMode] = useAtSearchMode();
  return (
    <SettingsPageContainer>
      <SettingsSection id="personal-customizations" title="Personal customizations">
        <ChatWidthSettingsRow />
        <SettingsRow
          id="model-mentions"
          title="Use @ to reference models"
          description="Search enabled models for subagent references. Turn off to restore the original file, thread and machine search."
          control={
            <Switch
              checked={mode === "models"}
              onCheckedChange={(checked) => setMode(checked ? "models" : "files")}
              aria-label="Use @ to reference models"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
