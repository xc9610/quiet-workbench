export type ProjectFileMatchReason = "linked" | "folder" | "filename";

export interface ProjectFileCandidate {
  path: string;
  basename: string;
  extension: string;
  modifiedAt?: number;
}

export interface ProjectFileMatch extends ProjectFileCandidate {
  reason: ProjectFileMatchReason;
}

export interface ProjectFileMatchInput {
  projectName: string;
  aliases?: readonly string[];
  files: readonly ProjectFileCandidate[];
  linkedPaths?: readonly string[];
  assetRoot?: string;
}

const DEFAULT_ASSET_ROOT = "60_附件_Assets/项目资料库";

export function normalizeProjectFileKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("/").pop()!
    .replace(/\.[^.]+$/, "")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function matchProjectFiles(input: ProjectFileMatchInput): ProjectFileMatch[] {
  const assetRoot = input.assetRoot ?? DEFAULT_ASSET_ROOT;
  const linkedPaths = new Set(input.linkedPaths ?? []);
  const keys = [...new Set([input.projectName, ...(input.aliases ?? [])]
    .map(normalizeProjectFileKey)
    .filter((key) => key.length >= 2))];
  const result = new Map<string, ProjectFileMatch>();

  for (const file of input.files) {
    if (file.extension.toLocaleLowerCase("en-US") === "md") continue;

    let reason: ProjectFileMatchReason | undefined;
    if (linkedPaths.has(file.path)) {
      reason = "linked";
    } else if (file.path === assetRoot || file.path.startsWith(`${assetRoot}/`)) {
      const segments = file.path.split("/").slice(0, -1).map(normalizeProjectFileKey);
      if (keys.some((key) => segments.includes(key))) {
        reason = "folder";
      } else {
        const basename = normalizeProjectFileKey(file.basename);
        if (keys.some((key) => key.length >= 4 && basename.includes(key))) reason = "filename";
      }
    }

    if (!reason) continue;
    const previous = result.get(file.path);
    if (!previous || reasonRank(reason) < reasonRank(previous.reason)) result.set(file.path, { ...file, reason });
  }

  return [...result.values()].sort((left, right) => {
    const priority = reasonRank(left.reason) - reasonRank(right.reason);
    if (priority !== 0) return priority;
    const recent = (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0);
    return recent || left.basename.localeCompare(right.basename, "zh-CN");
  });
}

function reasonRank(reason: ProjectFileMatchReason): number {
  if (reason === "linked") return 0;
  if (reason === "folder") return 1;
  return 2;
}
