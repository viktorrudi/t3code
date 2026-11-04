import { createFileRoute } from "@tanstack/react-router";
import { PersonalSettingsPanel } from "../personal/PersonalSettingsPanel";

export const Route = createFileRoute("/_chat/settings/personal")({
  component: PersonalSettingsPanel,
});
