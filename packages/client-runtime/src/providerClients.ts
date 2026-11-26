import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  isProviderDriverKind,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { makeProviderClientRegistry, type ProviderIcon } from "@t3tools/provider-core/client";
import { modelShortName } from "@t3tools/provider-core/modelShortName";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { fxClient } from "@t3tools/provider-fx/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { kiroClient } from "@t3tools/provider-kiro/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

// OpenRouter's Ink and Cloud glyphs from https://openrouter.ai/brand.
export const openRouterIcon: ProviderIcon = {
  viewBox: "0 0 1024 730",
  fill: { light: "#03080A", dark: "#FCFCFE" },
  paths: [
    {
      d: "M795.893 0C915.776 0 1012.95 97.9963 1012.95 218.88C1012.95 339.764 915.776 437.76 795.893 437.76L1011.2 654.869C1038.55 682.447 1019.18 729.6 980.504 729.6H361.77C161.97 729.6 0 566.273 0 364.8C0 163.327 161.97 0 361.77 0L795.893 0ZM361.77 145.92C241.89 145.92 144.708 243.916 144.708 364.8C144.708 485.684 241.89 583.68 361.77 583.68C481.649 583.68 578.831 485.684 578.831 364.8C578.831 243.916 481.649 145.92 361.77 145.92Z",
    },
  ],
};

// An original electric train front for LiteLLM instance branding.
export const liteLlmIcon: ProviderIcon = {
  viewBox: "0 0 24 24",
  fill: { light: "#4F46E5", dark: "#A5B4FC" },
  paths: [
    { d: "M8 1h8v1.6H8V1ZM9.4 2.6h1.7l.9 1.5.9-1.5h1.7L12.8 5.4h-1.6L9.4 2.6Z" },
    {
      d: "M6 6h12a2 2 0 0 1 2 2v8.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2ZM6.5 8.4h4.4v4.4H6.5V8.4ZM13.1 8.4h4.4v4.4h-4.4V8.4ZM6.9 16a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0ZM14.9 16a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0Z",
      fillRule: "evenodd",
    },
    { d: "M6.6 20.3h2.6L8 23H5.4l1.2-2.7ZM14.8 20.3h2.6l1.2 2.7H16l-1.2-2.7Z" },
  ],
};

// A gateway's public instance name can identify a brand different from its driver.
export function providerInstanceBrandIcon(displayName: string): ProviderIcon | null {
  return /(?<!\p{L})lite[\s_-]?llm(?!\p{L})/iu.test(displayName) ? liteLlmIcon : null;
}

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    modelFamilies: ["GPT-", "GPT "],
    acpRegistryAgentIds: ["codex-acp"],
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    modelFamilies: ["Claude "],
    acpRegistryAgentIds: ["claude-acp"],
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  fxClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    modelFamilies: ["Gemini "],
    acpRegistryAgentIds: ["antigravity-acp"],
    settingsSchema: AntigravitySettings,
  },
  kiroClient,
  museClient,
  piClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}

export function resolveModelShortName(
  model: { readonly name: string; readonly shortName?: string | undefined },
  driverKind: ProviderDriverKind | null | undefined,
): string | undefined {
  if (model.shortName) return model.shortName;
  const families = driverKind ? providerClients.get(driverKind)?.modelFamilies : undefined;
  return modelShortName(model.name, families ?? []);
}
