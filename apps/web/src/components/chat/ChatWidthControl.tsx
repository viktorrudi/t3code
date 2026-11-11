import type { ChatWidth } from "@t3tools/contracts/settings";
import { ArrowLeftRightIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const WIDTH_PRESETS: Record<ChatWidth, { label: string; next: ChatWidth }> = {
  comfortable: { label: "Comfortable", next: "wide" },
  wide: { label: "Wide", next: "full" },
  full: { label: "Full width", next: "comfortable" },
};

export function ChatWidthControl() {
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const preset = WIDTH_PRESETS[chatWidth];
  const label = `Chat width: ${preset.label}. Switch to ${WIDTH_PRESETS[preset.next].label}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="shrink-0 [-webkit-app-region:no-drag]"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={() => void updateClientSettings({ chatWidth: preset.next })}
          >
            <ArrowLeftRightIcon className="size-4" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
