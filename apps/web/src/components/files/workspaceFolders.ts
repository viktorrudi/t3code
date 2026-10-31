import { isAbsolutePath, normalizeProjectPathForComparison } from "@t3tools/shared/path";

export function filePathWithinFolder(folder: string, file: string): string | null {
  const root = normalizeProjectPathForComparison(folder);
  const path = normalizeProjectPathForComparison(file);
  const separator = root.includes("\\") ? "\\" : "/";
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return path.startsWith(prefix) ? file.slice(prefix.length) : null;
}

export function folderFilePath(folder: string, file: string, primary: string): string {
  if (folder === primary || isAbsolutePath(file)) return file;
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]$/, "")}${separator}${file}`;
}
