import type { LayoutItem } from "../../core/types";
import TaskListWidget from "./TaskListWidget.svelte";
import MemoWidget from "./MemoWidget.svelte";
import ScheduleWidget from "./ScheduleWidget.svelte";
import ProjectSummaryWidget from "./ProjectSummaryWidget.svelte";
import {
  memoProps,
  scheduleProps,
  summaryProps,
  taskListProps,
  widgetRenderKind,
  type WidgetRenderContext,
  type WidgetRenderKind
} from "./widget-props";

const WIDGET_COMPONENTS = {
  "task-list": TaskListWidget,
  memo: MemoWidget,
  schedule: ScheduleWidget,
  "project-summary": ProjectSummaryWidget
} as const;

/** One lookup for every migrated widget: the host no longer branches per id. */
export function resolveWidgetRender(item: LayoutItem, ctx: WidgetRenderContext) {
  const kind: WidgetRenderKind | undefined = widgetRenderKind(item, ctx.source, ctx.variant);
  if (!kind) return undefined;
  const props = kind === "task-list" ? taskListProps(ctx)
    : kind === "memo" ? memoProps(ctx)
      : kind === "schedule" ? scheduleProps(ctx)
        : summaryProps(ctx);
  return { kind, component: WIDGET_COMPONENTS[kind], props };
}
