import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  EnvironmentId,
  IssueTrackerKind,
  JiraIssueKey,
  SENSONEO_JIRA_HOST,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react-native";
import { useContext, useState } from "react";

import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { useEnvironmentServerConfig, useProject } from "../../state/entities";
import { jira } from "../../state/jira";
import { issueEnvironment, refreshIssueLists } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { issueCommandError } from "../issues/issuePresentation";
import { useJiraWorkMenu } from "../issues/useJiraWorkMenu";
import { usePullRequestConnected } from "../pull-requests/usePullRequestConnected";

const isJiraKey = Schema.is(JiraIssueKey);
const noEnvironment = EnvironmentId.make("unselected");
const jiraTracker = IssueTrackerKind.make("jira");

export function useThreadJiraMenu(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly id: ThreadId;
  } | null,
): AppBarMenu | null {
  const gt = useGT();
  const registry = useContext(RegistryContext);
  const navigation = useNavigation();
  const environmentId = thread?.environmentId ?? noEnvironment;
  const config = useEnvironmentServerConfig(thread?.environmentId ?? null);
  const project = useProject(thread);
  const connected = usePullRequestConnected(environmentId);
  const supported = config?.environment.capabilities.jiraThreadLinks === true;
  const mayLink = useAtomValue(jira.link.permissionAtom(environmentId));
  const link = useAtomCommand(jira.link, { reportFailure: false });
  const [linking, setLinking] = useState(false);
  const ticketsQuery = useEnvironmentQuery(
    supported ? jira.threadTickets({ environmentId, input: {} }) : null,
  );
  const releaseItems = useJiraWorkMenu(environmentId, connected);
  if (!supported || !thread) return null;
  const { id: threadId, projectId } = thread;
  const tickets = ticketsQuery.data?.threads[threadId] ?? [];
  const canLink =
    mayLink &&
    project &&
    /\/sensoneo\/(?:frontend|test-composer\/test-composer)\/?$/u.test(project.workspaceRoot);

  const setLink = async (key: string, linked: boolean) => {
    if (linking) return;
    setLinking(true);
    try {
      const result = await link({ environmentId, input: { threadId, key, linked } });
      const error = issueCommandError(result);
      if (error) Dialog.alert(gt("Could not update Jira link"), error);
      if (AsyncResult.isSuccess(result)) {
        if (!result.value.annotationsRefreshed) {
          Dialog.alert(gt("Jira link saved"), gt("The ticket display could not be refreshed yet."));
        }
        const issueRef = {
          tracker: jiraTracker,
          host: SENSONEO_JIRA_HOST,
          scope: key.split("-")[0]!,
          key,
        };
        refreshIssueLists(environmentId);
        registry.refresh(issueEnvironment.linkedThreads({ environmentId, input: issueRef }));
        registry.refresh(
          issueEnvironment.detail({ environmentId, input: { ...issueRef, projectId } }),
        );
      }
    } finally {
      setLinking(false);
    }
  };

  const items: AppBarMenuItem[] = tickets.map((ticket) => ({
    id: ticket.key,
    title: ticket.key,
    subtitle: ticket.deploy?.label,
    items: [
      ...(config.environment.capabilities.issues === true
        ? [
            {
              id: "open-issue",
              title: gt("Open issue"),
              icon: "arrow.up.right",
              onPress: () =>
                navigation.dispatch(
                  StackActions.push("Issue", {
                    environmentId,
                    projectId,
                    tracker: "jira",
                    host: SENSONEO_JIRA_HOST,
                    scope: ticket.key.split("-")[0]!,
                    issueKey: ticket.key,
                  }),
                ),
            },
          ]
        : []),
      ...releaseItems(ticket.key, ticket.deploy),
      ...(canLink
        ? [
            {
              id: "unlink",
              title: gt("Unlink Jira ticket"),
              disabled: linking || !connected,
              destructive: true,
              onPress: () =>
                Dialog.confirm({
                  title: gt("Unlink Jira ticket"),
                  message: gt("Remove {key} from this thread?", { key: ticket.key }),
                  confirmText: gt("Unlink"),
                  destructive: true,
                  onConfirm: () => void setLink(ticket.key, false),
                }),
            },
          ]
        : []),
    ],
  }));
  const linkItem: AppBarMenuItem | null = canLink
    ? {
        id: "link",
        title: gt("Link Jira ticket"),
        icon: "link",
        disabled: linking || !connected,
        onPress: () =>
          Dialog.prompt({
            title: gt("Link Jira ticket"),
            message: gt("Enter the Jira ticket key, such as RET-123."),
            initialValue: "",
            confirmText: gt("Link"),
            onConfirm: (value) => {
              const key = value.trim().toUpperCase();
              if (!isJiraKey(key)) {
                Dialog.alert(gt("Invalid Jira ticket key"));
                return;
              }
              void setLink(key, true);
            },
          }),
      }
    : null;
  if (items.length === 0 && !linkItem) return null;
  const first = tickets[0];
  return {
    title: gt("Jira tickets"),
    icon: "tag",
    ...(first ? { status: [first.key, first.deploy?.label].filter(Boolean).join(" · ") } : {}),
    items: linkItem ? [...items, linkItem] : items,
  };
}
