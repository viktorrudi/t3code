import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { getProjectWorkspaceRoots } from "@t3tools/contracts";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

export function SettingsProjectOverviewRouteScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const group = projectGroups.find((entry) => entry.key === selectedProjectKey);
  const selectedEnvironmentIds = new Set(selectedTargets.map((entry) => entry.environmentId));
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedEnvironmentIds.has(project.environmentId)) ?? [];

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Project overview" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {members.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              This project has no checkout on the selected connected environments. Change the filter
              above.
            </Text>
          ) : (
            <ProjectOverviewContent
              key={`${selectedProjectKey}:${members.map((member) => member.id).join(",")}`}
              members={members}
              environments={selectedTargets}
            />
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectOverviewContent(props: {
  readonly members: readonly EnvironmentProject[];
  readonly environments: readonly SettingsTarget[];
}) {
  const representative = props.members[0]!;
  const displayName = deriveProjectGroupLabel({ representative, members: props.members });
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const nextName = (draftName ?? displayName).trim();
  const canSave = !isSaving && nextName.length > 0 && nextName !== displayName;

  const saveName = () => {
    if (!canSave) return;
    setIsSaving(true);
    void (async () => {
      try {
        const results = await Promise.all(
          props.members.map((member) =>
            updateProject({
              environmentId: member.environmentId,
              input: { projectId: member.id, title: nextName },
            }),
          ),
        );
        if (results.every((result) => result._tag !== "Failure")) setDraftName(null);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  return (
    <>
      <View className="flex-row items-center gap-4 px-2">
        <ProjectFavicon
          environmentId={representative.environmentId}
          projectTitle={representative.title}
          workspaceRoot={representative.workspaceRoot}
          faviconPath={representative.faviconPath}
          projectIcon={representative.projectIcon}
          size={48}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-t3-semibold text-foreground" numberOfLines={2}>
            {displayName}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {props.members.length === 1 ? "1 checkout" : `${props.members.length} checkouts`}
          </Text>
        </View>
      </View>

      <SettingsSection title="Project">
        <View className="gap-3 p-4">
          <Text className="text-sm font-t3-medium text-foreground-muted">Name</Text>
          <View className="flex-row items-center gap-3">
            <AppTextInput
              accessibilityLabel="Project name"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              value={draftName ?? displayName}
              onChangeText={setDraftName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              editable={!isSaving}
            />
            {canSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save project name"
                onPress={saveName}
                className="rounded-full bg-subtle-strong px-4 py-2 active:opacity-70"
              >
                <Text className="text-sm font-t3-medium text-foreground">Save</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SettingsSection>

      {props.members.map((member) => (
        <ProjectFolders key={`${member.environmentId}:${member.id}`} project={member} />
      ))}
      <SettingsSection title="Checkouts">
        {props.members.map((member, index) => {
          const environment = props.environments.find(
            (entry) => entry.environmentId === member.environmentId,
          );
          return (
            <View
              key={`${member.environmentId}:${member.id}`}
              className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
            >
              <Text
                className={
                  Platform.OS === "android"
                    ? "text-base text-foreground"
                    : "text-lg text-foreground"
                }
              >
                {environment?.label ?? "Environment"}
              </Text>
              {environment?.displayUrl ? (
                <Text className="text-sm leading-normal text-foreground-muted">
                  {environment.displayUrl}
                </Text>
              ) : null}
              <Text className="text-sm leading-normal text-foreground-muted" selectable>
                {member.workspaceRoot}
              </Text>
            </View>
          );
        })}
      </SettingsSection>
    </>
  );
}

function ProjectFolders({ project }: { readonly project: EnvironmentProject }) {
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project folders update",
    reportFailure: true,
  });
  const roots = getProjectWorkspaceRoots(project);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(project.environmentId));
  const supported = serverConfig?.environment.capabilities.attachedProjectFolders === true;
  const canEdit =
    useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope) && supported;
  const save = async (workspaceRoot: string, additionalWorkspaceRoots: ReadonlyArray<string>) => {
    if (saving || !canEdit) return;
    setSaving(true);
    try {
      const result = await updateProject({
        environmentId: project.environmentId,
        input: { projectId: project.id, workspaceRoot, additionalWorkspaceRoots },
      });
      if (result._tag !== "Failure") setPath("");
    } finally {
      setSaving(false);
    }
  };
  const attach = () => {
    const next = path.trim();
    if (next && !roots.includes(next) && roots.length < 32)
      void save(project.workspaceRoot, [...roots.slice(1), next]);
  };
  return (
    <SettingsSection title="Folders">
      <View className="gap-4 p-4">
        {!supported ? (
          <Text className="text-sm text-foreground-muted">
            Update this environment’s T3 Code server to attach folders.
          </Text>
        ) : null}
        <Text className="text-sm text-foreground-muted">
          New chats, terminals, Git, and worktrees start in the primary folder. Paths refer to the
          computer hosting this project.
        </Text>
        {roots.map((root, index) => (
          <View key={root} className="gap-2">
            <Text className="text-base text-foreground" selectable>
              {root}
            </Text>
            {index === 0 ? (
              <Text className="text-sm text-foreground-muted">Primary</Text>
            ) : (
              <View className="flex-row flex-wrap gap-4">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Make ${root} primary`}
                  disabled={saving || !canEdit}
                  onPress={() =>
                    void save(
                      root,
                      roots.filter((entry) => entry !== root),
                    )
                  }
                  className="min-h-11 justify-center"
                >
                  <Text className="text-sm font-t3-medium text-primary-text">Make primary</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove folder ${root}`}
                  disabled={saving || !canEdit}
                  onPress={() =>
                    void save(
                      project.workspaceRoot,
                      roots.slice(1).filter((entry) => entry !== root),
                    )
                  }
                  className="min-h-11 justify-center"
                >
                  <Text className="text-sm font-t3-medium text-primary-text">Remove</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
        <AppTextInput
          accessibilityLabel="Folder path"
          placeholder="/path/to/folder"
          value={path}
          onChangeText={setPath}
          onSubmitEditing={attach}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving && canEdit && roots.length < 32}
          className="min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add folder"
          disabled={
            saving || !canEdit || !path.trim() || roots.includes(path.trim()) || roots.length >= 32
          }
          onPress={attach}
          className="min-h-11 justify-center"
        >
          <Text className="text-sm font-t3-medium text-primary-text">
            {saving ? "Saving…" : "Add folder"}
          </Text>
        </Pressable>
      </View>
    </SettingsSection>
  );
}
