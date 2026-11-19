import { WS_METHODS } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { createEnvironmentRpcCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentScope } from "../../state/session";
import { groupTitleRequest, SidebarThreadGroups, updateGroup } from "./sidebarThreadGroups.logic";

const STORAGE_KEY = "t3code:sidebar:thread-groups:v1";
const NO_GROUPS: SidebarThreadGroups = [];

export function useSidebarThreadGroups(): SidebarThreadGroups {
  return useLocalStorage(STORAGE_KEY, NO_GROUPS, SidebarThreadGroups)[0];
}

export function updateSidebarThreadGroups(
  update: (groups: SidebarThreadGroups) => SidebarThreadGroups,
): void {
  writeLocalStorageValue(STORAGE_KEY, update, NO_GROUPS, SidebarThreadGroups);
}

const generateGroupTitle = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:thread-groups:generate-title",
  tag: WS_METHODS.threadGroupsGenerateTitle,
});

// Only the latest request for a group may land; membership can change while one runs.
const titleRequests = new Map<string, symbol>();

/** Names the group from its members' titles unless the user named it. */
export async function generateSidebarThreadGroupTitle(
  groupId: string,
  members: ReadonlyArray<EnvironmentThreadShell>,
): Promise<void> {
  const request = groupTitleRequest(members);
  if (
    request === null ||
    !readEnvironmentScope(request.environmentId, AuthOrchestrationOperateScope)
  )
    return;
  const token = Symbol(groupId);
  titleRequests.set(groupId, token);
  const result = await runAtomCommand(
    appAtomRegistry,
    generateGroupTitle,
    {
      environmentId: request.environmentId,
      input: { projectId: request.projectId, threadTitles: request.threadTitles },
    },
    { reportFailure: false, reportDefect: false },
  );
  if (titleRequests.get(groupId) !== token) return;
  titleRequests.delete(groupId);
  if (result._tag === "Failure") return;
  const title = result.value.title.trim();
  updateSidebarThreadGroups((groups) =>
    groups.some((group) => group.id === groupId && !group.titleEdited)
      ? updateGroup(groups, groupId, { title })
      : groups,
  );
}
