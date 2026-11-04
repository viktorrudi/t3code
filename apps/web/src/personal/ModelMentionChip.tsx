import { serializeModelMention, type ModelMention } from "./modelMentions";
import { ContextChip, ContextChipLabel } from "../components/ContextChip";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

export function ModelMentionChip({ model }: { model: ModelMention }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="mention"
            aria-label={`${model.name}, ${model.providerName}`}
            data-markdown-copy={serializeModelMention(model)}
          >
            <ProviderInstanceIcon
              driverKind={model.driverKind}
              displayName={model.providerName}
              size="compact"
            />
            <ContextChipLabel>{model.name}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup>
        {model.providerName} · {model.model}
        <br />
        Provider: {model.instanceId}
      </TooltipPopup>
    </Tooltip>
  );
}
