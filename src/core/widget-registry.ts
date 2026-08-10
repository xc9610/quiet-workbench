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

export const BUILTIN_WIDGETS: RegisteredWidgetDefinition[] = [
  { id: "tasks.today", title: "今日任务", surfaces: both, pack: "tasks", refresh: "live", defaultSize: { width: 6, height: 5 } },
  { id: "core.calendar", title: "日历", surfaces: ["workbench"], pack: "core", refresh: "live", defaultSize: { width: 3, height: 5 } },
  { id: "core.quick-create", title: "快捷创建", surfaces: both, pack: "core", refresh: "manual", defaultSize: { width: 3, height: 2 } },
  { id: "core.diagnostics", title: "诊断", surfaces: both, pack: "core", refresh: "manual", defaultSize: { width: 3, height: 3 } },
  { id: "projects.recent", title: "最近项目", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 3, height: 3 } },
  { id: "projects.status", title: "项目状态", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 } },
  { id: "projects.milestones", title: "项目里程碑", surfaces: ["workbench"], pack: "project", refresh: "live", defaultSize: { width: 4, height: 4 } },
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

export function createBuiltinWidgetRegistry(): WidgetRegistry {
  return new WidgetRegistry(BUILTIN_WIDGETS);
}
