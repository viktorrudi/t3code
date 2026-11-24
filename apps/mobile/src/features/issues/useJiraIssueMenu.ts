import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, IssueSummary } from "@t3tools/contracts";
import { SENSONEO_JIRA_HOST } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { useEnvironmentServerConfig } from "../../state/entities";
import { jira } from "../../state/jira";
import { refreshIssueLists } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePullRequestConnected } from "../pull-requests/usePullRequestConnected";
import { issueCommandError } from "./issuePresentation";
import { useJiraWorkMenu } from "./useJiraWorkMenu";

export function useJiraIssueMenu(
  environmentId: EnvironmentId,
  issue: IssueSummary | null,
  refresh: () => void,
): AppBarMenuItem[] {
  const gt = useGT();
  const config = useEnvironmentServerConfig(environmentId);
  const connected = usePullRequestConnected(environmentId);
  const mayTransition = useAtomValue(jira.transition.permissionAtom(environmentId));
  const move = useAtomCommand(jira.transition, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const supported =
    config?.environment.capabilities.jiraThreadLinks === true &&
    issue?.tracker === "jira" &&
    issue.host === SENSONEO_JIRA_HOST;
  const query = useEnvironmentQuery(
    supported && connected && mayTransition
      ? jira.issue({ environmentId, input: { key: issue.key } })
      : null,
  );
  const releaseItems = useJiraWorkMenu(environmentId, connected, refresh);
  if (!supported) return [];
  const items = releaseItems(issue.key, issue.jiraWork?.deploy);
  const details = query.data;
  if (mayTransition && details?.transitions.length) {
    items.unshift({
      id: "jira-status",
      title: gt("Change Jira status"),
      items: details.transitions.map((transition) => ({
        id: transition.id,
        title: transition.name,
        subtitle: transition.toStatus === transition.name ? undefined : transition.toStatus,
        disabled: busy || !connected,
        onPress: () =>
          Dialog.confirm({
            title: gt("Change Jira status"),
            message: gt("Move {key} from {current} to {status}?", {
              key: issue.key,
              current: details.status.name,
              status: transition.toStatus,
            }),
            confirmText: gt("Move"),
            onConfirm: async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              try {
                const result = await move({
                  environmentId,
                  input: { key: issue.key, transitionId: transition.id },
                });
                const error = issueCommandError(result);
                if (error) Dialog.alert(gt("Could not change Jira status"), error);
                else refreshIssueLists(environmentId);
                refresh();
                query.refresh();
              } finally {
                pending.current = false;
                setBusy(false);
              }
            },
          }),
      })),
    });
  }
  return items;
}
