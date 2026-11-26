import { useGT } from "gt-react";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { ChatWidthSettingsRow } from "../components/settings/ChatWidthSettingsRow";
import { Switch } from "../components/ui/switch";
import { useAtSearchMode, useSidebarShowBranches } from "./personalSettings";

export function PersonalSettingsPanel() {
  const gt = useGT();
  const [mode, setMode] = useAtSearchMode();
  const [showBranches, setShowBranches] = useSidebarShowBranches();
  return (
    <SettingsPageContainer>
      <SettingsSection id="personal-customizations" title={gt("Personal customizations")}>
        <ChatWidthSettingsRow />
        <SettingsRow
          id="sidebar-show-branches"
          title={gt("Show branches on sidebar cards")}
          description={gt("Display the Git branch on chat cards in the sidebar.")}
          control={
            <Switch
              checked={showBranches}
              onCheckedChange={setShowBranches}
              aria-label={gt("Show branches on sidebar cards")}
            />
          }
        />
        <SettingsRow
          id="model-mentions"
          title={gt("Use @ to reference models")}
          description={gt(
            "Search enabled models for subagent references. Turn off to restore the original file, thread and machine search.",
          )}
          control={
            <Switch
              checked={mode === "models"}
              onCheckedChange={(checked) => setMode(checked ? "models" : "files")}
              aria-label={gt("Use @ to reference models")}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
