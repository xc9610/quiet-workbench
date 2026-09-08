import type { TaskRecord } from "../core/types";
import type { HeroCopyContext } from "../core/hero-copy";
import { dateAfter, effectiveTaskDate } from "./widget-data";

export type HeroMetricTone = "danger" | "accent" | "normal";

export interface HeroMetric {
  label: string;
  value: number;
  note: string;
  tone: HeroMetricTone;
}

export interface HeroMetricSnapshot {
  tasks: ReadonlyArray<Pick<TaskRecord, "completed" | "migrated" | "scheduled" | "due">>;
  projects: ReadonlyArray<{ detail?: string }>;
}

export function buildHeroContext(current: HeroMetricSnapshot, today: string): HeroCopyContext {
  const weekEnd = dateAfter(today, 7);
  const tasks = current.tasks.filter((task) => !task.completed && !task.migrated);
  const overdue = tasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date < today);
  }).length;
  const dueToday = tasks.filter((task) => effectiveTaskDate(task) === today).length;
  const upcoming = tasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date > today && date <= weekEnd);
  }).length;
  const missingNext = current.projects.filter((project) => !project.detail?.trim()).length;
  return { overdue, dueToday, upcoming, missingNext };
}

export function buildHeroMetrics(context: HeroCopyContext): HeroMetric[] {
  return [
    { label: "逾期任务", value: context.overdue, note: "overdue", tone: "danger" },
    { label: "今天到期", value: context.dueToday, note: "due today", tone: "accent" },
    { label: "未来 7 天", value: context.upcoming, note: "upcoming", tone: "normal" },
    { label: "缺少下一步", value: context.missingNext, note: "next action", tone: context.missingNext ? "danger" : "normal" }
  ];
}
