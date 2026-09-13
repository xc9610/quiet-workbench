export const PROJECT_TYPES = ["售前方案", "合同交付", "内部研发"] as const;

export type ProjectType = typeof PROJECT_TYPES[number];

const PROJECT_TYPE_ALIASES: Record<string, ProjectType> = {
  "售前方案": "售前方案",
  "售前项目": "售前方案",
  "合同交付": "合同交付",
  "交付项目": "合同交付",
  "内部研发": "内部研发",
  "研发项目": "内部研发"
};

export function normalizeProjectType(value?: string): ProjectType | undefined {
  return PROJECT_TYPE_ALIASES[(value ?? "").trim()];
}

export function isPreSalesProject(value?: string): boolean {
  return normalizeProjectType(value) === "售前方案";
}

export function matchesProjectType(value: string | undefined, filter: "全部" | ProjectType): boolean {
  return filter === "全部" || normalizeProjectType(value) === filter;
}

export function projectFolderForType(baseFolder: string, value?: string): string {
  const projectType = normalizeProjectType(value);
  if (!projectType) return baseFolder;
  const normalized = baseFolder.replace(/\/+$/u, "");
  const configuredType = PROJECT_TYPES.find((candidate) => normalized.endsWith(`/${candidate}`));
  const root = configuredType ? normalized.slice(0, -(configuredType.length + 1)) : normalized;
  return `${root}/${projectType}`;
}
