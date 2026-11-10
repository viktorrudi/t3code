import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { AppModelOption } from "../modelSelection";
import type { ProviderInstanceEntry } from "../providerInstances";
import { projectModelInstances } from "./projectModels";

export interface ModelMention {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly providerName: string;
  readonly model: string;
  readonly name: string;
}

const PREFIX = "t3-model://reference?";

export function modelMentionKey(model: Pick<ModelMention, "instanceId" | "model">): string {
  return JSON.stringify([model.instanceId, model.model]);
}

export function modelMentionHref(model: ModelMention): string {
  return `${PREFIX}${new URLSearchParams({
    provider: model.instanceId,
    model: model.model,
    driver: model.driverKind,
    providerName: model.providerName,
    name: model.name,
  })}`;
}

export function parseModelMentionHref(href: string): ModelMention | null {
  if (!href.startsWith(PREFIX) || href.length > 4096) return null;
  const params = new URLSearchParams(href.slice(PREFIX.length));
  const instanceId = params.get("provider");
  const model = params.get("model");
  const driverKind = params.get("driver");
  const providerName = params.get("providerName");
  const name = params.get("name");
  if (!instanceId || !model || !driverKind || !providerName || !name) return null;
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind: ProviderDriverKind.make(driverKind),
    providerName,
    model,
    name,
  };
}

// Markdown carries delegation IDs through existing drafts and provider prompts unchanged.
export function serializeModelMention(model: ModelMention): string {
  const label = `${model.name} · ${model.providerName}`.replace(/[\\[\]]/g, "\\$&");
  return `[${label}](${modelMentionHref(model)})`;
}

export function parseModelMentionSource(source: string): ModelMention | null {
  const href = /^\[((?:\\.|[^\]\\\n]){1,1024})\]\((t3-model:\/\/reference\?[^\s)]{1,4096})\)$/.exec(
    source,
  )?.[2];
  return href ? parseModelMentionHref(href) : null;
}

export function collectModelMentions(text: string) {
  const matches = text.matchAll(
    /\[((?:\\.|[^\]\\\n]){1,1024})\]\((t3-model:\/\/reference\?[^\s)]{1,4096})\)/g,
  );
  return Array.from(matches).flatMap((match) => {
    const model = parseModelMentionHref(match[2]!);
    return model
      ? [
          {
            type: "context-reference" as const,
            kind: "model",
            contextId: modelMentionKey(model),
            label: model.name,
            source: match[0],
            start: match.index,
            end: match.index + match[0].length,
          },
        ]
      : [];
  });
}

export function modelMentionMatches(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptions: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  projectTitle: string | null;
  query: string;
  recentKeys: ReadonlyArray<string>;
}): Array<ModelMention & { readonly entry: ProviderInstanceEntry }> {
  const words = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = projectModelInstances(input.entries, input.projectTitle).flatMap((entry) => {
    if (!entry.enabled || !entry.isAvailable) return [];
    return (input.modelOptions.get(entry.instanceId) ?? []).flatMap((option) => {
      if (option.isUnavailable) return [];
      const haystack = [
        entry.displayName,
        entry.instanceId,
        option.name,
        option.slug,
        ...(option.aliases ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word))
        ? [
            {
              instanceId: entry.instanceId,
              driverKind: entry.driverKind,
              providerName: entry.displayName,
              model: option.slug,
              name: option.name,
              entry,
            },
          ]
        : [];
    });
  });
  if (words.length > 0) return matches;
  const recent = input.recentKeys
    .map((key) => matches.find((model) => modelMentionKey(model) === key))
    .find((model) => model !== undefined);
  return recent ? [recent, ...matches.filter((model) => model !== recent)] : matches;
}
