import type { LayoutItem, TaskScope } from "./types";

export type WidgetTypeId =
  | "view.list"
  | "view.board"
  | "view.calendar"
  | "view.quadrant"
  | "view.timeline"
  | "view.metrics"
  | "view.detail"
  | "view.relations"
  | "control.selector"
  | "control.actions"
  | "capture.memo";

export type WidgetDataSource = "tasks" | "projects" | "clients" | "meetings" | "knowledge" | "mixed";
export type WidgetScopeMode = "all" | "fixed" | "shared" | "context";

export interface WidgetInstanceConfig {
  source: {
    kind: WidgetDataSource;
    scopeMode: WidgetScopeMode;
    projectPath?: string;
    clientPath?: string;
    projectType?: string;
    taskScopes?: TaskScope[];
  };
  query: {
    mode?: string;
    groupBy?: string;
    metric?: string;
    search?: string;
    includeCompleted?: boolean;
    limit?: number;
  };
  display?: {
    variant?: string;
    compact?: boolean;
  };
  actions?: string[];
}

export interface WidgetPresetDefinition {
  id: string;
  title: string;
  description: string;
  typeId: WidgetTypeId;
  config: WidgetInstanceConfig;
}

function config(
  kind: WidgetDataSource,
  patch: Partial<WidgetInstanceConfig> = {}
): WidgetInstanceConfig {
  return {
    source: {
      kind,
      scopeMode: "all",
      taskScopes: kind === "tasks" ? ["project", "client", "meeting-draft"] : undefined,
      ...patch.source
    },
    query: { limit: 30, includeCompleted: false, ...patch.query },
    display: { ...patch.display },
    actions: patch.actions ? [...patch.actions] : []
  };
}

export const WIDGET_PRESETS: ReadonlyArray<Readonly<WidgetPresetDefinition>> = Object.freeze([
  { id: "tasks.today-focus", title: "今日焦点", description: "今天、逾期和高优先任务的快速处理列表", typeId: "view.list", config: config("tasks", { query: { mode: "today-focus", limit: 50 }, actions: ["complete", "edit", "yolo", "migrate"] }) },
  { id: "tasks.all", title: "全部任务", description: "可搜索和筛选的任务列表", typeId: "view.list", config: config("tasks", { query: { mode: "all" }, actions: ["complete", "edit", "yolo"] }) },
  { id: "tasks.inbox", title: "任务收件箱", description: "无日期、客户行动和会议草稿", typeId: "view.list", config: config("tasks", { query: { mode: "inbox" }, actions: ["complete", "migrate"] }) },
  { id: "tasks.waiting", title: "等待与跟进", description: "等待回复、确认或外部条件", typeId: "view.list", config: config("tasks", { query: { mode: "waiting" } }) },
  { id: "tasks.week", title: "本周任务", description: "未来七天计划和截止任务", typeId: "view.list", config: config("tasks", { query: { mode: "week" } }) },
  { id: "tasks.recurring", title: "重复任务", description: "识别周期性任务约定", typeId: "view.list", config: config("tasks", { query: { mode: "recurring" } }) },
  { id: "tasks.project-matrix", title: "项目任务矩阵", description: "按项目分组汇总任务", typeId: "view.list", config: config("tasks", { display: { variant: "project-matrix" } }) },
  { id: "tasks.client-actions", title: "客户行动", description: "按客户分组汇总行动", typeId: "view.list", config: config("tasks", { display: { variant: "client-groups" } }) },
  { id: "tasks.time-board", title: "任务时间看板", description: "逾期、今天、本周、以后和未安排", typeId: "view.board", config: config("tasks", { query: { groupBy: "time" } }) },
  { id: "tasks.calendar", title: "任务日历", description: "按计划或截止日期查看任务", typeId: "view.calendar", config: config("tasks") },
  { id: "tasks.quadrant", title: "任务四象限", description: "重要度和紧急度矩阵", typeId: "view.quadrant", config: config("tasks") },
  { id: "tasks.timeline", title: "任务时间线", description: "按日期连续展示任务", typeId: "view.timeline", config: config("tasks") },
  { id: "tasks.workload", title: "任务工作量", description: "未来七天任务数量", typeId: "view.metrics", config: config("tasks", { query: { metric: "workload" } }) },
  { id: "projects.list", title: "项目列表", description: "搜索与筛选开放项目", typeId: "view.list", config: config("projects") },
  { id: "projects.recent", title: "最近项目", description: "按最近更新时间显示项目", typeId: "view.list", config: config("projects", { query: { mode: "recent", limit: 10 }, display: { compact: true } }) },
  { id: "projects.risks", title: "项目风险", description: "只显示需要关注的项目", typeId: "view.list", config: config("projects", { query: { mode: "risks" } }) },
  { id: "projects.milestones", title: "项目里程碑", description: "显示具有目标日期的项目", typeId: "view.list", config: config("projects", { query: { mode: "milestones" } }) },
  { id: "projects.meetings", title: "项目会议", description: "指定项目的相关会议", typeId: "view.list", config: config("meetings", { source: { kind: "meetings", scopeMode: "shared" } }) },
  { id: "projects.actions", title: "项目会议行动", description: "指定项目的待迁移会议行动", typeId: "view.list", config: config("tasks", { source: { kind: "tasks", scopeMode: "shared", taskScopes: ["meeting-draft"] }, query: { mode: "meeting-actions" } }) },
  { id: "projects.waiting", title: "项目等待事项", description: "指定项目的等待和阻塞任务", typeId: "view.list", config: config("tasks", { source: { kind: "tasks", scopeMode: "shared" }, query: { mode: "waiting" } }) },
  { id: "projects.status-board", title: "项目状态看板", description: "按状态或阶段分列项目", typeId: "view.board", config: config("projects", { query: { groupBy: "status" } }) },
  { id: "projects.task-board", title: "项目任务看板", description: "共享项目的任务时间看板", typeId: "view.board", config: config("tasks", { source: { kind: "tasks", scopeMode: "shared" }, query: { groupBy: "time" } }) },
  { id: "projects.activity", title: "项目最近动态", description: "最近修改的项目和会议", typeId: "view.timeline", config: config("mixed", { query: { mode: "project-activity" } }) },
  { id: "projects.health", title: "项目健康度", description: "逾期、停滞和下一步信号", typeId: "view.metrics", config: config("projects", { source: { kind: "projects", scopeMode: "shared" }, query: { metric: "health" } }) },
  { id: "projects.progress", title: "项目进度", description: "任务完成率和逾期数量", typeId: "view.metrics", config: config("projects", { source: { kind: "projects", scopeMode: "shared" }, query: { metric: "progress" } }) },
  { id: "projects.summary", title: "项目摘要", description: "一个项目的核心信息", typeId: "view.detail", config: config("projects", { source: { kind: "projects", scopeMode: "shared" } }) },
  { id: "projects.relations", title: "项目关系", description: "客户、会议和知识关联", typeId: "view.relations", config: config("projects", { source: { kind: "projects", scopeMode: "shared" } }) },
  { id: "projects.selector", title: "项目选择器", description: "搜索并发布共享项目", typeId: "control.selector", config: config("projects") },
  { id: "projects.actions-control", title: "项目快捷操作", description: "项目、任务、会议和 YOLO 操作", typeId: "control.actions", config: config("projects", { source: { kind: "projects", scopeMode: "shared" }, actions: ["create-project", "create-task", "create-meeting", "open", "yolo"] }) }
]);

export function getWidgetPreset(id?: string): WidgetPresetDefinition | undefined {
  const preset = id ? WIDGET_PRESETS.find((candidate) => candidate.id === id) : undefined;
  return preset ? structuredClone(preset) : undefined;
}

export function presetsForType(typeId: string): WidgetPresetDefinition[] {
  return WIDGET_PRESETS.filter((preset) => preset.typeId === typeId).map((preset) => structuredClone(preset));
}

export function defaultConfigForType(typeId: WidgetTypeId): WidgetInstanceConfig {
  if (typeId === "view.detail" || typeId === "view.relations" || typeId === "control.actions") {
    return config("projects", { source: { kind: "projects", scopeMode: "shared" } });
  }
  if (typeId === "control.selector") return config("projects");
  if (typeId === "capture.memo") return config("mixed");
  if (typeId === "view.metrics") return config("tasks", { query: { metric: "workload" } });
  if (typeId === "view.board") return config("tasks", { query: { groupBy: "time" } });
  return config("tasks");
}

const LEGACY_PRESETS: Record<string, string> = {
  "tasks.today": "tasks.today-focus",
  "tasks.list": "tasks.all",
  "tasks.board": "tasks.time-board",
  "tasks.calendar": "tasks.calendar",
  "core.calendar": "tasks.calendar",
  "tasks.quadrant": "tasks.quadrant",
  "tasks.inbox": "tasks.inbox",
  "tasks.waiting": "tasks.waiting",
  "tasks.week": "tasks.week",
  "tasks.timeline": "tasks.timeline",
  "tasks.workload": "tasks.workload",
  "tasks.recurring": "tasks.recurring",
  "tasks.project-matrix": "tasks.project-matrix",
  "tasks.client-actions": "tasks.client-actions",
  "tasks.project": "tasks.all",
  "projects.recent": "projects.recent",
  "projects.list": "projects.list",
  "projects.search": "projects.selector",
  "projects.board": "projects.status-board",
  "projects.status": "projects.status-board",
  "projects.summary": "projects.summary",
  "projects.health": "projects.health",
  "projects.progress": "projects.progress",
  "projects.tasks-list": "tasks.all",
  "projects.tasks-board": "projects.task-board",
  "projects.milestones": "projects.milestones",
  "projects.meetings": "projects.meetings",
  "projects.actions": "projects.actions",
  "projects.waiting": "projects.waiting",
  "projects.risks": "projects.risks",
  "projects.activity": "projects.activity",
  "projects.relations": "projects.relations",
  "projects.quick-actions": "projects.actions-control"
};

export function migrateLegacyWidgetItem(item: LayoutItem, index: number): LayoutItem {
  const presetId = LEGACY_PRESETS[item.widgetId];
  if (!presetId) return structuredClone(item);
  const preset = getWidgetPreset(presetId)!;
  const legacyConfig = item.config ? structuredClone(item.config) : {};
  const instanceId = item.instanceId || `${preset.typeId}-${item.widgetId.replace(/[^a-z0-9.-]/giu, "-")}-${index + 1}`;
  return {
    ...item,
    widgetId: preset.typeId,
    instanceId,
    title: item.title || preset.title,
    presetId,
    config: mergeLegacyConfig(preset.config, legacyConfig)
  };
}

function mergeLegacyConfig(
  base: WidgetInstanceConfig,
  legacy: Record<string, unknown>
): Record<string, unknown> {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  const source = { ...(result.source as Record<string, unknown>) };
  const query = { ...(result.query as Record<string, unknown>) };
  for (const [key, value] of Object.entries(legacy)) {
    if (["scopeMode", "projectPath", "clientPath", "projectType", "taskScopes"].includes(key)) source[key] = value;
    else if (["mode", "groupBy", "metric", "search", "includeCompleted", "limit"].includes(key)) query[key] = value;
    else result[key] = value;
  }
  result.source = source;
  result.query = query;
  return result;
}
