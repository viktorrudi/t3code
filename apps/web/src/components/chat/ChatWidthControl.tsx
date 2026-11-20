import { msg, useGT, useMessages } from "gt-react";
import type { ChatWidth } from "@t3tools/contracts/settings";
import { ArrowLeftRightIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const WIDTH_PRESETS: Record<ChatWidth, { label: string; next: ChatWidth }> = {
  comfortable: { label: msg("Comfortable"), next: "wide" },
  wide: { label: msg("Wide"), next: "full" },
  full: { label: msg("Full width"), next: "comfortable" },
};

export function ChatWidthControl() {
  const gt = useGT();
  const m = useMessages();
  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  const preset = WIDTH_PRESETS[chatWidth];
  const label = gt("Chat width: {current}. Switch to {next}", {
    current: m(preset.label),
    next: m(WIDTH_PRESETS[preset.next].label),
  });

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
