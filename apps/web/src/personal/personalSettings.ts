import * as Schema from "effect/Schema";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { rememberEnvironmentMention } from "./environmentMentions";

const AT_SEARCH_MODE_KEY = "t3code:personal:at-search";
const SIDEBAR_SHOW_BRANCHES_KEY = "t3code:personal:sidebar-show-branches";
const RECENT_MODEL_MENTIONS_KEY = "t3code:personal:recent-model-mentions";
const RECENT_ENVIRONMENT_MENTIONS_KEY = "t3code:personal:recent-environment-mentions";
const EMPTY_ENVIRONMENT_RECENTS: readonly string[] = [];
const RecentEnvironmentMentions = Schema.Array(Schema.String);
const AtSearchMode = Schema.Literals(["models", "files"]);
const RecentModelMentions = Schema.Record(Schema.String, Schema.Array(Schema.String));
const EMPTY_RECENTS: typeof RecentModelMentions.Type = {};

export function useAtSearchMode() {
  return useLocalStorage(AT_SEARCH_MODE_KEY, "models", AtSearchMode);
}

export function useSidebarShowBranches() {
  return useLocalStorage(SIDEBAR_SHOW_BRANCHES_KEY, true, Schema.Boolean);
}

export function useRecentEnvironmentMentions() {
  const [recentIds, setRecentIds] = useLocalStorage(
    RECENT_ENVIRONMENT_MENTIONS_KEY,
    EMPTY_ENVIRONMENT_RECENTS,
    RecentEnvironmentMentions,
  );
  return {
    recentIds,
    remember: (environmentId: string) =>
      setRecentIds((current) => rememberEnvironmentMention(current, environmentId)),
  };
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
