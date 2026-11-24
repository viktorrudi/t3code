import { collectComposerModelMentions } from "@t3tools/client-runtime/composer-model-mentions";

export const MODEL_DELEGATION_SUFFIX = " as subagent";

export function collectMobileModelMentions(text: string) {
  return collectComposerModelMentions(text).map((mention) => {
    const end = mention.end + MODEL_DELEGATION_SUFFIX.length;
    const hasDelegation =
      text.slice(mention.end, end) === MODEL_DELEGATION_SUFFIX &&
      !/[\p{L}\p{N}_-]/u.test(text[end] ?? "");
    return hasDelegation ? { ...mention, end, source: text.slice(mention.start, end) } : mention;
  });
}
