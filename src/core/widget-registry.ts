import type { WidgetDefinition, WorkbenchSurface } from "./types";

export type WidgetConfigIssue = {
  path: string;
  message: string;
};

export type WidgetConfigValidator = (
  config: Readonly<Record<string, unknown>>
) => WidgetConfigIssue[];

export interface RegisteredWidgetDefinition extends WidgetDefinition {
  description?: string;
  showInLibrary?: boolean;
  libraryCategory?: "view" | "control" | "capture";
  validateConfig?: WidgetConfigValidator;
}

export class WidgetRegistry {
  private readonly definitions = new Map<string, RegisteredWidgetDefinition>();

  constructor(definitions: RegisteredWidgetDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: RegisteredWidgetDefinition): void {
    assertWidgetDefinition(definition);
    if (this.definitions.has(definition.id)) {
      throw new Error(`Widget already registered: ${definition.id}`);
    }
    this.definitions.set(definition.id, freezeDefinition(definition));
  }

  unregister(id: string): boolean {
    return this.definitions.delete(id);
  }

  get(id: string): RegisteredWidgetDefinition | undefined {
    return this.definitions.get(id);
  }

  require(id: string): RegisteredWidgetDefinition {
    const definition = this.get(id);
    if (!definition) {
      throw new Error(`Unknown widget: ${id}`);
    }
    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(surface?: WorkbenchSurface): RegisteredWidgetDefinition[] {
    return [...this.definitions.values()].filter(
      (definition) => !surface || definition.surfaces.includes(surface)
    );
  }

  validateConfig(id: string, config: Record<string, unknown> = {}): WidgetConfigIssue[] {
    const definition = this.get(id);
    if (!definition) {
      return [{ path: "widgetId", message: `Unknown widget: ${id}` }];
    }
    return definition.validateConfig?.(config) ?? [];
  }
}

function assertWidgetDefinition(definition: RegisteredWidgetDefinition): void {
  if (!/^[a-z][a-z0-9.-]*$/.test(definition.id)) {
    throw new Error(`Invalid widget id: ${definition.id}`);
  }
  if (!definition.title.trim()) {
    throw new Error(`Widget title is required: ${definition.id}`);
  }
  if (definition.surfaces.length === 0) {
    throw new Error(`Widget must support at least one surface: ${definition.id}`);
  }
  if (definition.defaultSize.width <= 0 || definition.defaultSize.height <= 0) {
    throw new Error(`Widget size must be positive: ${definition.id}`);
  }
}

function freezeDefinition(
  definition: RegisteredWidgetDefinition
): RegisteredWidgetDefinition {
  return Object.freeze({
    ...definition,
    surfaces: Object.freeze([...definition.surfaces]) as WorkbenchSurface[],
    defaultSize: Object.freeze({ ...definition.defaultSize })
  });
}

const both: WorkbenchSurface[] = ["workbench", "sidebar"];

function validateFocusConfig(config: Readonly<Record<string, unknown>>): WidgetConfigIssue[] {
  const issues: WidgetConfigIssue[] = [];
  const allowedQuick = new Set(["all", "overdue", "today", "high"]);
  if (config.quick !== undefined && (typeof config.quick !== "string" || !allowedQuick.has(config.quick))) {
    issues.push({ path: "quick", message: "Unsupported quick filter" });
  }
  const arrays: Array<[string, Set<string> | undefined]> = [
    ["scopes", new Set(["project", "client", "meeting-draft"])],
    ["projectTypes", undefined],
    ["clients", undefined],
    ["priorities", new Set(["highest", "high", "normal", "low", "lowest"])],
    ["statuses", new Set(["open", "completed"])]
  ];
  for (const [key, allowed] of arrays) {
    const value = config[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || (allowed && !allowed.has(entry)))) {
      issues.push({ path: key, message: `${key} must be an array of supported strings` });
    } else if (value.length > 200) {
      issues.push({ path: key, message: `${key} contains too many values` });
    }
  }
  return issues;
}

function validateCollectionConfig(config: Readonly<Record<string, unknown>>): WidgetConfigIssue[] {
  const issues: WidgetConfigIssue[] = [];
  if (config.scopeMode !== undefined && (typeof config.scopeMode !== "string" || !["all", "fixed", "shared", "context"].includes(config.scopeMode))) {
    issues.push({ path: "scopeMode", message: "Unsupported data scope" });
  }
  for (const key of ["projectPath", "clientPath", "meetingPath", "supplierPath", "projectType", "status", "search"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      issues.push({ path: key, message: `${key} must be a string` });
    }
  }
  if (config.limit !== undefined && (!Number.isInteger(config.limit) || Number(config.limit) < 1 || Number(config.limit) > 200)) {
    issues.push({ path: "limit", message: "limit must be an integer from 1 to 200" });
  }
  if (config.includeCompleted !== undefined && typeof config.includeCompleted !== "boolean") {
    issues.push({ path: "includeCompleted", message: "includeCompleted must be a boolean" });
  }
  if (config.taskScopes !== undefined && (!Array.isArray(config.taskScopes) || config.taskScopes.some((value) => typeof value !== "string" || !["project", "client", "meeting-draft"].includes(value)))) {
    issues.push({ path: "taskScopes", message: "taskScopes must contain supported task sources" });
  }
  return issues;
}

function validateGenericConfig(config: Readonly<Record<string, unknown>>): WidgetConfigIssue[] {
  const issues: WidgetConfigIssue[] = [];
  const source = config.source;
  const query = config.query;
  const display = config.display;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issues.push({ path: "source", message: "source must be an object" });
  } else {
    const value = source as Record<string, unknown>;
    if (!["tasks", "projects", "clients", "suppliers", "meetings", "knowledge", "mixed"].includes(String(value.kind))) {
      issues.push({ path: "source.kind", message: "Unsupported data source" });
    }
    if (!["all", "fixed", "shared", "context"].includes(String(value.scopeMode))) {
      issues.push({ path: "source.scopeMode", message: "Unsupported data scope" });
    }
    issues.push(...validateCollectionConfig(value).map((issue) => ({ ...issue, path: `source.${issue.path}` })));
  }
  if (query !== undefined && (typeof query !== "object" || Array.isArray(query))) {
    issues.push({ path: "query", message: "query must be an object" });
  } else if (query) {
    issues.push(...validateCollectionConfig(query as Record<string, unknown>).map((issue) => ({ ...issue, path: `query.${issue.path}` })));
  }
  if (display !== undefined && (typeof display !== "object" || Array.isArray(display))) {
    issues.push({ path: "display", message: "display must be an object" });
  }
  if (config.actions !== undefined && (!Array.isArray(config.actions) || config.actions.some((entry) => typeof entry !== "string"))) {
    issues.push({ path: "actions", message: "actions must be an array of strings" });
  }
  return issues;
}

const GENERIC_WIDGETS: RegisteredWidgetDefinition[] = [
  { id: "view.list", title: "列表", description: "任务、项目、客户、会议或知识的通用列表", surfaces: both, pack: "core", refresh: "live", defaultSize: { width: 6, height: 5 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.board", title: "看板", description: "按状态、时间或其他字段分列", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 8, height: 6 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.calendar", title: "日历", description: "按计划或截止日期查看条目", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 7, height: 6 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.quadrant", title: "四象限", description: "按重要与紧急程度组织任务", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 8, height: 6 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.timeline", title: "时间线", description: "按日期连续展示任务或项目动态", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 6, height: 5 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.metrics", title: "指标", description: "工作量、健康度或进度摘要", surfaces: both, pack: "core", refresh: "live", defaultSize: { width: 4, height: 4 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.detail", title: "详情", description: "一个实体的核心信息", surfaces: both, pack: "core", refresh: "live", defaultSize: { width: 4, height: 4 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "view.relations", title: "关系", description: "客户、会议、知识和项目之间的关联", surfaces: both, pack: "core", refresh: "live", defaultSize: { width: 5, height: 4 }, libraryCategory: "view", validateConfig: validateGenericConfig },
  { id: "control.selector", title: "选择器", description: "选择并发布共享项目或实体", surfaces: both, pack: "core", refresh: "live", defaultSize: { width: 4, height: 3 }, libraryCategory: "control", validateConfig: validateGenericConfig },
  { id: "control.actions", title: "快捷操作", description: "为当前上下文提供创建、打开和 YOLO 操作", surfaces: both, pack: "core", refresh: "manual", defaultSize: { width: 4, height: 3 }, libraryCategory: "control", validateConfig: validateGenericConfig }
];

const LEGACY_WIDGETS: RegisteredWidgetDefinition[] = [
  { id: "tasks.today", title: "今日焦点", surfaces: both, pack: "tasks", refresh: "live", defaultSize: { width: 8, height: 6 }, validateConfig: validateFocusConfig },
  { id: "tasks.list", title: "任务列表", description: "可筛选的完整任务列表", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 6, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "tasks.board", title: "任务看板", description: "按时间状态分列查看任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 8, height: 6 }, validateConfig: validateCollectionConfig },
  { id: "tasks.calendar", title: "任务日历", description: "按计划或截止日期查看任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 7, height: 6 }, validateConfig: validateCollectionConfig },
  { id: "tasks.quadrant", title: "任务四象限", description: "按重要与紧急程度整理任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 8, height: 6 }, validateConfig: validateCollectionConfig },
  { id: "tasks.inbox", title: "任务收件箱", description: "未安排、客户行动和会议草稿", surfaces: both, pack: "tasks", refresh: "live", defaultSize: { width: 5, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "tasks.waiting", title: "等待与跟进", description: "等待回复、确认或外部条件的任务", surfaces: both, pack: "tasks", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "tasks.week", title: "本周任务", description: "未来七天计划和截止任务", surfaces: both, pack: "tasks", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "tasks.timeline", title: "任务时间线", description: "按日期连续展示任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 6, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "tasks.workload", title: "任务工作量", description: "按日期统计近期任务数量", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "tasks.recurring", title: "重复任务", description: "识别周期性任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "tasks.project-matrix", title: "项目任务矩阵", description: "按项目汇总未完成任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 7, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "tasks.client-actions", title: "客户行动", description: "按客户汇总行动任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 6, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "tasks.upcoming", title: "近期待办", surfaces: ["sidebar"], pack: "tasks", refresh: "live", defaultSize: { width: 1, height: 4 } },
  { id: "core.calendar", title: "日历", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 3, height: 5 } },
  { id: "capture.memo", title: "速记", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 4, height: 3 } },
  { id: "core.quick-create", title: "快捷创建", surfaces: both, pack: "core", refresh: "manual", defaultSize: { width: 3, height: 2 } },
  { id: "core.diagnostics", title: "诊断", surfaces: both, pack: "core", refresh: "manual", defaultSize: { width: 3, height: 3 } },
  { id: "projects.recent", title: "最近项目", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 3, height: 3 } },
  { id: "projects.list", title: "项目列表", description: "搜索与筛选全部开放项目", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "projects.search", title: "项目搜索器", description: "快速打开或设为共享项目", surfaces: both, pack: "project", refresh: "live", defaultSize: { width: 4, height: 3 }, validateConfig: validateCollectionConfig },
  { id: "projects.board", title: "项目状态看板", description: "按项目状态分列查看", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 8, height: 6 }, validateConfig: validateCollectionConfig },
  { id: "projects.summary", title: "项目摘要", description: "一个项目的核心信息", surfaces: both, pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.health", title: "项目健康度", description: "自动识别延期、积压和停滞", surfaces: both, pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.progress", title: "项目进度", description: "任务完成率与逾期数量", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 4, height: 3 }, validateConfig: validateCollectionConfig },
  { id: "projects.tasks-list", title: "项目任务列表", description: "指定项目的任务列表", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 6, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "projects.tasks-board", title: "项目任务看板", description: "指定项目的任务看板", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 8, height: 6 }, validateConfig: validateCollectionConfig },
  { id: "projects.status", title: "项目状态", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "projects.milestones", title: "项目里程碑", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "projects.meetings", title: "项目会议", description: "指定项目的相关会议", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.actions", title: "项目会议行动", description: "指定项目的待迁移会议行动", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.waiting", title: "项目等待事项", description: "项目中等待和阻塞的行动", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.risks", title: "项目风险", description: "自动识别项目风险信号", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.activity", title: "项目最近动态", description: "最近修改的项目、会议与任务", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 6, height: 5 }, validateConfig: validateCollectionConfig },
  { id: "projects.relations", title: "项目关系", description: "客户、会议和知识关联", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 5, height: 4 }, validateConfig: validateCollectionConfig },
  { id: "projects.quick-actions", title: "项目快捷操作", description: "创建项目、任务、会议和打开 YOLO", surfaces: both, pack: "project", refresh: "manual", defaultSize: { width: 4, height: 3 }, validateConfig: validateCollectionConfig },
  { id: "tasks.project", title: "项目任务", surfaces: ["workbench"], pack: "tasks", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "meetings.actions", title: "会议行动项", surfaces: ["workbench"], pack: "meeting", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "clients.list", title: "客户", surfaces: ["workbench"], pack: "client", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "suppliers.list", title: "供应商", surfaces: ["workbench"], pack: "supplier", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "knowledge.inbox", title: "知识收件箱", surfaces: ["workbench"], pack: "knowledge", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "knowledge.triage", title: "待沉淀知识", surfaces: ["workbench"], pack: "knowledge", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "knowledge.project-links", title: "项目关联", surfaces: ["workbench"], pack: "knowledge", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "knowledge.recent", title: "最近笔记", surfaces: ["workbench"], pack: "knowledge", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "core.context", title: "当前笔记", surfaces: ["sidebar"], pack: "core", refresh: "live", defaultSize: { width: 1, height: 3 } },
  { id: "tasks.context", title: "相关任务", surfaces: ["sidebar"], pack: "tasks", refresh: "live", defaultSize: { width: 1, height: 4 } },
  { id: "projects.context", title: "关联项目", surfaces: ["sidebar"], pack: "project", refresh: "live", defaultSize: { width: 1, height: 3 } },
  { id: "meetings.context", title: "相关会议", surfaces: ["sidebar"], pack: "meeting", refresh: "live", defaultSize: { width: 1, height: 3 } }
];

export const BUILTIN_WIDGETS: RegisteredWidgetDefinition[] = [
  ...GENERIC_WIDGETS,
  ...LEGACY_WIDGETS.map((definition) => ({
    ...definition,
    showInLibrary: definition.id === "capture.memo",
    libraryCategory: definition.id === "capture.memo" ? "capture" as const : definition.libraryCategory
  }))
];

export function createBuiltinWidgetRegistry(): WidgetRegistry {
  return new WidgetRegistry(BUILTIN_WIDGETS);
}
