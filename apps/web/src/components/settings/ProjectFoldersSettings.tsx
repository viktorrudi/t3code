import { getProjectWorkspaceRoots } from "@t3tools/contracts";
import type { Project } from "~/types";
import { useState } from "react";

import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Folder paths belong to this checkout's environment, including on remote connections. */
export function ProjectFoldersSettings({
  project,
  disabled,
}: {
  project: Project;
  disabled: boolean;
}) {
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const updateProject = useOrchestrationCommand(projectEnvironment.update);
  const roots = getProjectWorkspaceRoots(project);
  const { environments } = useEnvironments();
  const supported =
    environments.find((environment) => environment.environmentId === project.environmentId)
      ?.serverConfig?.environment?.capabilities.attachedProjectFolders === true;
  const cannotEdit = disabled || !supported;
  const save = async (workspaceRoot: string, additionalWorkspaceRoots: ReadonlyArray<string>) => {
    if (saving || cannotEdit) return;
    setSaving(true);
    const result = await updateProject({
      environmentId: project.environmentId,
      input: { projectId: project.id, workspaceRoot, additionalWorkspaceRoots },
    });
    if (result._tag !== "Failure") setPath("");
    setSaving(false);
  };
  const attach = () => {
    const next = path.trim();
    if (next && !roots.includes(next)) void save(project.workspaceRoot, [...roots.slice(1), next]);
  };
  return (
    <SettingsSection title="Folders">
      {!supported ? (
        <p className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
          Update this environment’s T3 Code server to attach folders.
        </p>
      ) : null}
      <SettingsRow
        title="Primary folder"
        description="New chats, terminals, Git, and worktrees start here."
      />
      {roots.map((root, index) => (
        <SettingsRow
          key={root}
          title={root.split(/[\\/]/).filter(Boolean).at(-1) ?? root}
          description={<span className="break-all">{root}</span>}
          status={index === 0 ? "Primary" : undefined}
          control={
            index === 0 ? undefined : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving || cannotEdit}
                  onClick={() =>
                    void save(
                      root,
                      roots.filter((entry) => entry !== root),
                    )
                  }
                >
                  Make primary
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving || cannotEdit}
                  aria-label={`Remove folder ${root}`}
                  onClick={() =>
                    void save(
                      project.workspaceRoot,
                      roots.slice(1).filter((entry) => entry !== root),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            )
          }
        />
      ))}
      <SettingsRow
        title="Add folder"
        description="Use a folder path on the computer that hosts this project."
        control={
          <form
            className="flex w-full flex-wrap gap-2 sm:w-96"
            onSubmit={(event) => {
              event.preventDefault();
              attach();
            }}
          >
            <div className="min-w-40 flex-1">
              <Input
                size="sm"
                aria-label="Folder path"
                placeholder="/path/to/folder"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={saving || cannotEdit || roots.length >= 32}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={
                saving ||
                cannotEdit ||
                !path.trim() ||
                roots.includes(path.trim()) ||
                roots.length >= 32
              }
            >
              {saving ? "Saving…" : "Add folder"}
            </Button>
          </form>
        }
      />
      <p className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
        Attached folders stay available when the primary folder uses a worktree. Codex and Claude
        receive folder access automatically; other agents may ask for permission.
      </p>
    </SettingsSection>
  );
}
