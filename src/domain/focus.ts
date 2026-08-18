import type { TaskRecord, TaskScope } from "../core/types";

export type FocusQuickFilter = "all" | "overdue" | "today" | "high";
export type FocusTaskStatus = "open" | "completed";

export interface FocusTaskRecord extends TaskRecord {
  projectType?: string;
  clientIds: string[];
}

export interface FocusFilters {
  quick: FocusQuickFilter;
  scopes: TaskScope[];
  projectTypes: string[];
  clients: string[];
  priorities: NonNullable<TaskRecord["priority"]>[];
  statuses: FocusTaskStatus[];
}

export const DEFAULT_FOCUS_FILTERS: FocusFilters = {
  quick: "all",
  scopes: [],
  projectTypes: [],
  clients: [],
  priorities: [],
  statuses: ["open"]
};

export interface FocusEntityReference {
  path: string;
  name: string;
  aliases?: string[];
}

export function resolveEntityReference<T extends FocusEntityReference>(value: string | undefined, entities: T[]): T | undefined {
  const rawTarget = rawEntityTarget(value);
  if (!rawTarget) return undefined;
  const exact = rawTarget.replace(/\.md$/iu, "").toLocaleLowerCase("zh-CN");
  const exactMatch = entities.find((entity) => entity.path.replace(/\.md$/iu, "").toLocaleLowerCase("zh-CN") === exact);
  if (exactMatch) return exactMatch;
  const comparable = normalizeEntityLink(rawTarget).toLocaleLowerCase("zh-CN");
  return entities.find((entity) => [entity.name, entity.path.split("/").pop()?.replace(/\.md$/iu, "") ?? "", ...(entity.aliases ?? [])]
    .some((name) => name.toLocaleLowerCase("zh-CN") === comparable));
}

export function normalizeEntityLink(value?: string): string {
  if (!value) return "";
  return value
    .replace(/^\s*["']|["']\s*$/gu, "")
    .replace(/\[\[([^\]|]+)\|[^\]]+\]\]/gu, "$1")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .split("/")
    .pop()
    ?.replace(/\.md$/iu, "")
    .trim() ?? "";
}

function rawEntityTarget(value?: string): string {
  if (!value) return "";
  const link = value.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/u)?.[1];
  return (link ?? value).replace(/^\s*["']|["']\s*$/gu, "").trim();
}

export function filterFocusTasks(
  tasks: FocusTaskRecord[],
  filters: FocusFilters,
  today: string
): FocusTaskRecord[] {
  return tasks
    .filter((task) => matchesQuickFilter(task, filters.quick, today))
    .filter((task) => matchesGroup(filters.scopes, task.scope))
    .filter((task) => matchesGroup(filters.projectTypes, task.projectType))
    .filter((task) => matchesAny(filters.clients, task.clientIds))
    .filter((task) => matchesGroup(filters.priorities, task.priority ?? "normal"))
    .filter((task) => matchesGroup(filters.statuses, task.completed ? "completed" : "open"))
    .sort((left, right) => compareFocusTasks(left, right, today));
}

export function activeFocusFilterCount(filters: FocusFilters): number {
  return [
    filters.scopes.length,
    filters.projectTypes.length,
    filters.clients.length,
    filters.priorities.length,
    isDefaultStatus(filters.statuses) ? 0 : filters.statuses.length
  ].reduce((sum, count) => sum + count, 0);
}

function matchesQuickFilter(task: TaskRecord, quick: FocusQuickFilter, today: string): boolean {
  if (quick === "all") return true;
  if (quick === "overdue") return !task.completed && Boolean(task.due && task.due < today);
  if (quick === "high") return !task.completed && (task.priority === "highest" || task.priority === "high");
  return !task.completed && (task.due === today || task.scheduled === today);
}

function matchesGroup<T>(selected: T[], value: T | undefined): boolean {
  return selected.length === 0 || (value !== undefined && selected.includes(value));
}

function matchesAny(selected: string[], values: string[]): boolean {
  return selected.length === 0 || values.some((value) => selected.includes(value));
}

function isDefaultStatus(statuses: FocusTaskStatus[]): boolean {
  return statuses.length === 1 && statuses[0] === "open";
}

function compareFocusTasks(left: TaskRecord, right: TaskRecord, today: string): number {
  const leftOverdue = Boolean(left.due && left.due < today);
  const rightOverdue = Boolean(right.due && right.due < today);
  if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
  const leftDate = left.scheduled ?? left.due ?? "9999-99-99";
  const rightDate = right.scheduled ?? right.due ?? "9999-99-99";
  const dateOrder = leftDate.localeCompare(rightDate);
  if (dateOrder !== 0) return dateOrder;
  const priorityOrder = priorityRank(left.priority) - priorityRank(right.priority);
  return priorityOrder || left.path.localeCompare(right.path, "zh-CN") || left.line - right.line;
}

function priorityRank(priority?: TaskRecord["priority"]): number {
  return { highest: 0, high: 1, normal: 2, low: 3, lowest: 4 }[priority ?? "normal"];
}
