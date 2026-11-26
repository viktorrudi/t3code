import { useGT, useMessages } from "gt-react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarMenu } from "../../components/ui/AppBar.types";
import type { EnvironmentId, ProjectId, ThreadId, ThreadIssueLink } from "@t3tools/contracts";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
import { threadHeaderMenuItems } from "./threadHeaderMenu";
import { useThreadJiraMenu } from "./useThreadJiraMenu";

export function ThreadHeader(props: {
  readonly title: string;
  readonly thread?: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly id: ThreadId;
    readonly issues?: ReadonlyArray<ThreadIssueLink>;
  };
  readonly subtitle: string;
  readonly statusSubtitle?: string | null;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const jiraMenu = useThreadJiraMenu(props.thread ?? null);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const menus = [jiraMenu, gitMenu, terminalMenu].filter(
    (menu): menu is AppBarMenu => menu !== null,
  );
  const overflow: AppBarMenu = {
    title: gt("More actions"),
    icon: "ellipsis",
    items: [
      ...threadHeaderMenuItems(menus),
      ...(props.hasThreadCwd
        ? [
            {
              id: "files",
              title: filesVisible ? gt("Close files") : gt("Open files"),
              icon: "folder",
              disabled: !props.gitControls.canOpenFiles,
              selected: filesVisible,
              onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
            },
          ]
        : []),
      ...(props.draft
        ? []
        : [
            {
              id: "compose",
              title: gt("New task"),
              icon: "square.and.pencil",
              onPress: startNewTask,
            },
          ]),
    ],
  };

  return (
    <AppBar
      title={props.title}
      subtitle={[props.statusSubtitle, jiraMenu?.status, props.subtitle]
        .filter(Boolean)
        .join(" · ")}
      onBackToList={goBack}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      menus={[overflow]}
      hideBottomBorder
    />
  );
}
