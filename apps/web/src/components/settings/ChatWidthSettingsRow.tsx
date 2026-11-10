import { DEFAULT_UNIFIED_SETTINGS, type ChatWidth } from "@t3tools/contracts/settings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: "Comfortable",
  wide: "Wide",
  full: "Full width",
};

export function ChatWidthSettingsRow() {
  const chatWidth = useScopedSettings((settings) => settings.chatWidth);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("chat-width")}
      description="Set the maximum width of messages and the composer. Smaller screens still fit the available space."
      resetAction={
        chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
          <SettingResetButton
            label="chat width"
            onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-40">
          <Select
            value={chatWidth}
            onValueChange={(value) => {
              if (value === "comfortable" || value === "wide" || value === "full")
                updateSettings({ chatWidth: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Chat width">
              <SelectValue>{CHAT_WIDTH_LABELS[chatWidth]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="comfortable">Comfortable (default)</SelectItem>
              <SelectItem value="wide">Wide</SelectItem>
              <SelectItem value="full">Full width</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
