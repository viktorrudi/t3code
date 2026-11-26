import { describe, expect, it } from "vite-plus/test";

import { liteLlmIcon, providerInstanceBrandIcon } from "./providerClients.ts";

describe("providerInstanceBrandIcon", () => {
  it.each([
    ["♻️ LiteLLM [Sensoneo]", liteLlmIcon],
    ["Litellm Sensoneo", liteLlmIcon],
    ["lite-llm work", liteLlmIcon],
    ["litellm_proxy", liteLlmIcon],
    ["Claude Personal", null],
    ["♻️ Claude [Sensoneo]", null],
    ["Satellite LLM", null],
  ])("resolves %s", (displayName, icon) => {
    expect(providerInstanceBrandIcon(displayName)).toBe(icon);
  });
});
