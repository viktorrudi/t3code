import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { __setClientSettingsForTests } from "../../hooks/useSettings";
import { projectModelInstances } from "../../personal/projectModels";
import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

it("keeps each registry image when adding a model from another ACP agent", async () => {
  const icons = [
    "https://cdn.agentclientprotocol.com/registry/icons/picker-explicit.svg",
    "https://cdn.agentclientprotocol.com/registry/v1/latest/picker-by-id.svg",
  ];
  const cache = await caches.open("t3-acp-registry-icons-v1");
  await using _cachedIcons = {
    async [Symbol.asyncDispose]() {
      await Promise.all(icons.map((url) => cache.delete(url)));
    },
  };
  for (const [index, url] of icons.entries()) {
    await cache.put(
      url,
      new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${11 + index * 6}" height="10"><path d="M0 0h10v10H0z"/></svg>`,
        { headers: { "content-type": "image/svg+xml" } },
      ),
    );
  }
  const entries = deriveProviderInstanceEntries(
    ["First", "Second"].map((name) => ({
      instanceId: ProviderInstanceId.make(name.toLowerCase()),
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: `${name} agent`,
      enabled: true,
      installed: true,
      version: null,
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { slug: name.toLowerCase(), name: `${name} model`, isCustom: false, capabilities: {} },
      ],
      slashCommands: [],
      skills: [],
    })),
  ).map((entry, index) => ({
    ...entry,
    ...(index === 0 ? { acpRegistryIconUrl: icons[0] } : { acpRegistryAgentId: "picker-by-id" }),
  }));
  const first = { instanceId: entries[0]!.instanceId, model: "first" };
  const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));

  function Picker() {
    const [selection, setSelection] = useState<ReadonlyArray<ModelSelection>>([first]);
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={first.instanceId}
        model={first.model}
        {...(selection.length > 1 ? { selectedModels: selection } : {})}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        onToggleModel={(instanceId, model) => setSelection([...selection, { instanceId, model }])}
        onInstanceModelChange={(instanceId, model) => setSelection([{ instanceId, model }])}
      />
    );
  }

  await using screen = await render(<Picker />);
  const imageWidths = () =>
    Array.from(
      screen.container.querySelectorAll<HTMLImageElement>("[data-chat-provider-model-picker] img"),
      (image) => image.naturalWidth,
    );
  await vi.waitFor(() => expect(imageWidths()).toEqual([11]));
  await screen.getByRole("button", { name: "First model", exact: true }).click();
  await page.getByRole("button", { name: "Second agent", exact: true }).click();
  await userEvent.keyboard("{Shift>}");
  try {
    await page.getByRole("option", { name: /Second model/ }).click();
  } finally {
    await userEvent.keyboard("{/Shift}");
  }
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(imageWidths()).toEqual([11, 17]));
});

it("keeps a docked picker open after a pick and hands focus to that model's effort", async () => {
  const instanceId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  const options = new Map([
    [
      instanceId,
      [
        { slug: "original", name: "Original model" },
        { slug: "second", name: "Second model" },
        { slug: "plain", name: "Plain model" },
      ],
    ],
  ]);
  // The last level is the selected one; "plain" has no effort to pick.
  const levels: Record<string, ReadonlyArray<string>> = {
    original: ["Low", "High"],
    second: ["Medium"],
    plain: [],
  };

  function Picker() {
    const [model, setModel] = useState("original");
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        triggerAriaLabel="Choose model"
        onInstanceModelChange={(_, selected) => setModel(selected)}
        effortColumn={(levels[model] ?? []).map((level, index, all) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={index === all.length - 1}
            data-effort-row
            data-effort-level
          >
            {level}
          </button>
        ))}
      />
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const search = page.getByPlaceholder("Search models...");
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("radio", { name: "High" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(search).toHaveFocus();

  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();

  await page.getByRole("option", { name: /Plain model/ }).click();
  await page.getByRole("option", { name: /Second model/ }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).not.toBeInTheDocument();
});

it.each(["Sensoneo", "Personal"])(
  "filters providers, favorites and search for %s",
  async (projectTitle) => {
    const entries = deriveProviderInstanceEntries(
      ["codex", "claude-sensoneo", "litellm-sensoneo", "cursor"].map((id) => ({
        instanceId: ProviderInstanceId.make(id),
        driver: ProviderDriverKind.make(id === "cursor" ? "cursor" : "codex"),
        displayName: id,
        enabled: true,
        installed: true,
        version: null,
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: "2026-01-01T00:00:00.000Z",
        models: [{ slug: id + "-model", name: id + " model", isCustom: false, capabilities: {} }],
        skills: [],
        slashCommands: [],
      })),
    );
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: entries.map((entry) => ({
        provider: entry.instanceId,
        model: entry.models[0]!.slug,
      })),
    });
    using _settings = {
      [Symbol.dispose]: () => __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS),
    };
    const eligible = projectModelInstances(entries, projectTitle);
    const excluded = entries.filter((entry) => !eligible.includes(entry));
    const current = excluded[0]!;
    const options = new Map(entries.map((entry) => [entry.instanceId, entry.models]));
    const picker = (key: string) => (
      <ProviderModelPicker
        key={key}
        environmentId={null}
        activeInstanceId={current.instanceId}
        model={current.models[0]!.slug}
        lockedProvider={null}
        instanceEntries={entries}
        pickerInstanceEntries={eligible}
        modelOptionsByInstance={options}
        triggerAriaLabel="Choose model"
        onInstanceModelChange={() => {}}
      />
    );
    await using screen = await render(picker("favorites"));
    await screen.getByRole("button", { name: "Choose model" }).click();
    for (const entry of eligible) {
      await expect
        .element(page.getByRole("option", { name: new RegExp(entry.models[0]!.name) }))
        .toBeVisible();
      await expect
        .element(page.getByRole("button", { name: entry.displayName, exact: true }))
        .toBeVisible();
    }
    for (const entry of excluded) {
      await expect
        .element(page.getByRole("option", { name: new RegExp(entry.models[0]!.name) }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole("button", { name: entry.displayName, exact: true }))
        .not.toBeInTheDocument();
    }
    await userEvent.fill(page.getByPlaceholder("Search models..."), "model");
    for (const entry of excluded) {
      await expect
        .element(page.getByRole("option", { name: new RegExp(entry.models[0]!.name) }))
        .not.toBeInTheDocument();
    }
    await userEvent.keyboard("{Escape}");
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    await screen.rerender(picker("no-favorites"));
    await screen.getByRole("button", { name: "Choose model" }).click();
    await expect
      .element(page.getByRole("option", { name: new RegExp(eligible[0]!.models[0]!.name) }))
      .toBeVisible();
  },
);
