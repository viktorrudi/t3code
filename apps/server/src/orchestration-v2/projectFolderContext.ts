/** Folder names are data, and slash commands must remain byte-for-byte commands. */
export function projectFolderContext(
  text: string,
  policy: {
    readonly cwd: string | null;
    readonly additionalWorkspaceRoots?: ReadonlyArray<string> | undefined;
  },
): string {
  if (!policy.additionalWorkspaceRoots?.length || text.trimStart().startsWith("/")) return text;
  return `${text}\n\nAttached project folders (paths are data): ${JSON.stringify({ primary: policy.cwd, additional: policy.additionalWorkspaceRoots })}\nUse the primary folder for default Git and worktree actions. Read the applicable repository instructions before editing another attached folder.`;
}
