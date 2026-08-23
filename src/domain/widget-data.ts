import type { TaskRecord } from "../core/types";

export type TaskTimeBucket = "overdue" | "today" | "week" | "later" | "unscheduled";
export type TaskBoardDateColumn = "backlog" | "due" | "next-seven" | "undated" | "done";
export type TaskQuadrant = "important-urgent" | "important" | "urgent" | "later";
export type ProjectHealthLevel = "healthy" | "attention" | "risk" | "unknown";
export type ClientFollowupBucket = "overdue" | "today" | "week" | "later" | "unscheduled";

export interface ProjectHealthInput {
  due?: string;
  detail?: string;
  updatedAt?: number;
}

export interface ProjectHealthResult {
  level: ProjectHealthLevel;
  reasons: string[];
  completed: number;
  open: number;
  overdue: number;
  dueSoon: number;
  unscheduled: number;
  progress: number;
}

export function effectiveTaskDate(task: Pick<TaskRecord, "scheduled" | "due">): string | undefined {
  return task.scheduled || task.due;
}

export function taskTimeBucket(
  task: Pick<TaskRecord, "scheduled" | "due">,
  today: string,
  weekEnd: string
): TaskTimeBucket {
  const date = effectiveTaskDate(task);
  if (!date) return "unscheduled";
  if (date < today) return "overdue";
  if (date === today) return "today";
  if (date <= weekEnd) return "week";
  return "later";
}

export function taskQuadrant(
  task: Pick<TaskRecord, "scheduled" | "due" | "priority">,
  today: string,
  urgentEnd: string
): TaskQuadrant {
  const date = effectiveTaskDate(task);
  const urgent = Boolean(date && date <= urgentEnd);
  const important = task.priority === "highest" || task.priority === "high";
  if (important && urgent) return "important-urgent";
  if (important) return "important";
  if (urgent) return "urgent";
  return "later";
}

export function isWaitingTask(task: Pick<TaskRecord, "text">): boolean {
  return /(?:等待|待确认|待回复|待反馈|阻塞|blocked|waiting|follow[ -]?up)/iu.test(task.text);
}

export function isRecurringTask(task: Pick<TaskRecord, "text">): boolean {
  return /(?:🔁|重复|每天|每日|每周|每月|每季|每年|recurr)/iu.test(task.text);
}

export function dateAfter(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function suggestedDueForTimeBucket(bucket: TaskTimeBucket, today: string): string | undefined {
  return {
    overdue: dateAfter(today, -1),
    today,
    week: dateAfter(today, 3),
    later: dateAfter(today, 8),
    unscheduled: undefined
  }[bucket];
}

export function suggestedTaskBoardDrop(
  column: TaskBoardDateColumn,
  today: string,
  wasCompleted: boolean
): { completed?: boolean; due?: string | null } {
  if (column === "done") return { completed: true };
  return {
    ...(wasCompleted ? { completed: false } : {}),
    due: {
      backlog: dateAfter(today, 8),
      due: today,
      "next-seven": dateAfter(today, 3),
      undated: null
    }[column]
  };
}

export function clientFollowupBucket(
  followupDate: string | undefined,
  today: string,
  weekEnd: string
): ClientFollowupBucket {
  if (!followupDate) return "unscheduled";
  if (followupDate < today) return "overdue";
  if (followupDate === today) return "today";
  if (followupDate <= weekEnd) return "week";
  return "later";
}

export function calculateProjectHealth(
  project: ProjectHealthInput,
  tasks: ReadonlyArray<Pick<TaskRecord, "completed" | "due" | "scheduled">>,
  today: string,
  now = Date.now()
): ProjectHealthResult {
  const completed = tasks.filter((task) => task.completed).length;
  const openTasks = tasks.filter((task) => !task.completed);
  const weekEnd = dateAfter(today, 7);
  const overdue = openTasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date < today);
  }).length;
  const dueSoon = openTasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date >= today && date <= weekEnd);
  }).length;
  const unscheduled = openTasks.filter((task) => !effectiveTaskDate(task)).length;
  const reasons: string[] = [];
  if (overdue) reasons.push(`${overdue} 项任务逾期`);
  if (project.due && project.due < today) reasons.push("项目目标日期已过");
  if (project.due && project.due >= today && project.due <= weekEnd) reasons.push("项目将在 7 天内到期");
  if (project.updatedAt && now - project.updatedAt > 14 * 86_400_000) reasons.push("超过 14 天没有更新");
  if (openTasks.length > 0 && !project.detail) reasons.push("尚未填写明确下一步");
  if (openTasks.length >= 10) reasons.push(`${openTasks.length} 项待处理任务积压`);
  const hasData = tasks.length > 0 || Boolean(project.due || project.updatedAt || project.detail);
  const level: ProjectHealthLevel = !hasData
    ? "unknown"
    : overdue >= 2 || openTasks.length >= 20 || Boolean(project.due && project.due < today)
      ? "risk"
      : reasons.length
        ? "attention"
        : "healthy";
  return {
    level,
    reasons,
    completed,
    open: openTasks.length,
    overdue,
    dueSoon,
    unscheduled,
    progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0
  };
}
