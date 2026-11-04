import * as Schema from "effect/Schema";
import { useLocalStorage } from "../hooks/useLocalStorage";

const AT_SEARCH_MODE_KEY = "t3code:personal:at-search";
const RECENT_MODEL_MENTIONS_KEY = "t3code:personal:recent-model-mentions";
const AtSearchMode = Schema.Literals(["models", "files"]);
const RecentModelMentions = Schema.Record(Schema.String, Schema.Array(Schema.String));
const EMPTY_RECENTS: typeof RecentModelMentions.Type = {};

export function useAtSearchMode() {
  return useLocalStorage(AT_SEARCH_MODE_KEY, "models", AtSearchMode);
}

export function useRecentModelMentions(environmentId: string) {
  const [recents, setRecents] = useLocalStorage(
    RECENT_MODEL_MENTIONS_KEY,
    EMPTY_RECENTS,
    RecentModelMentions,
  );
  return {
    recentKeys: recents[environmentId] ?? [],
    remember: (key: string) =>
      setRecents((current) => ({
        ...current,
        [environmentId]: [
          key,
          ...(current[environmentId] ?? []).filter((value) => value !== key),
        ].slice(0, 30),
      })),
  };
}
