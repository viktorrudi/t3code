import { msg, useGT, useMessages } from "gt-react";
import { DEFAULT_UNIFIED_SETTINGS, type ChatWidth } from "@t3tools/contracts/settings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: msg("Comfortable"),
  wide: msg("Wide"),
  full: msg("Full width"),
};

export function ChatWidthSettingsRow() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const chatWidth = useScopedSettings((settings) => settings.chatWidth);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("chat-width")}
      description={gt(
        "Set the maximum width of messages and the composer. Smaller screens still fit the available space.",
      )}
      resetAction={
        chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
          <SettingResetButton
            ariaLabel={gt("Reset chat width to default")}
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
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Chat width")}>
              <SelectValue>{m(CHAT_WIDTH_LABELS[chatWidth])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="comfortable">{gt("Comfortable (default)")}</SelectItem>
              <SelectItem value="wide">{m(CHAT_WIDTH_LABELS.wide)}</SelectItem>
              <SelectItem value="full">{m(CHAT_WIDTH_LABELS.full)}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
