import type { LayoutItem, TaskRecord } from "../../core/types";
import type { MonthCalendarCell } from "../../domain/calendar";
import type { CalendarEntry } from "../../domain/calendar-entries";
import { projectStatusLabel } from "../../domain/project-status";
import { PROJECT_ANIMALS, projectAnimalEmoji } from "../project-animals";
import type { WorkbenchController, WorkbenchSnapshot } from "../controller";
import type {
  AgendaGroup,
  ClientEntity,
  DayTask,
  MeetingEntity,
  ProjectEntity,
  SummaryModel,
  SummaryRenderModel,
  SupplierEntity
} from "./widget-contracts";

export type WidgetRenderKind = "task-list" | "memo" | "schedule" | "project-summary";

const MEMO_IDS = new Set(["capture.memo"]);
const SCHEDULE_IDS = new Set(["tasks.calendar", "view.calendar", "core.calendar"]);
const SUMMARY_IDS = new Set(["projects.summary", "view.detail"]);
const TASK_LIST_IDS = new Set(["tasks.list", "projects.tasks-list", "view.list"]);
const TASK_LIST_VARIANTS = new Set(["project-matrix", "client-groups"]);

/** Widget ids with their own module resolve here instead of the legacy if-chain. */
export function widgetRenderKind(item: LayoutItem, source: string, variant: string): WidgetRenderKind | undefined {
  if (MEMO_IDS.has(item.widgetId)) return "memo";
  if (SCHEDULE_IDS.has(item.widgetId)) return "schedule";
  if (SUMMARY_IDS.has(item.widgetId)) return "project-summary";
  if (!TASK_LIST_IDS.has(item.widgetId)) return undefined;
  if (item.widgetId === "view.list" && (source !== "tasks" || TASK_LIST_VARIANTS.has(variant))) return undefined;
  return "task-list";
}

export interface WidgetEntityHelpers {
  selectedProject: (item: LayoutItem) => ProjectEntity | undefined;
  selectedClient: (item: LayoutItem) => ClientEntity | undefined;
  selectedMeeting: (item: LayoutItem) => MeetingEntity | undefined;
  selectedSupplier: (item: LayoutItem) => SupplierEntity | undefined;
  projectsForClient: (path: string) => ProjectEntity[];
  tasksForClient: (path: string) => TaskRecord[];
  meetingsForClient: (path: string) => MeetingEntity[];
  openTaskCountFor: (path: string) => number;
  projectHealth: (project: ProjectEntity) => { completed: number; open: number };
  projectClientLabel: (project: ProjectEntity) => string;
  projectUpdatedLabel: (project: ProjectEntity) => string;
  projectAnimalValue: (path: string) => string;
  setProjectAnimal: (path: string, value: string) => void;
}

export interface WidgetRenderContext {
  item: LayoutItem;
  source: string;
  variant: string;
  query: string;
  key: string;
  busy: boolean;
  writesEnabled: boolean;
  search: string;
  snapshot: WorkbenchSnapshot;
  controller: WorkbenchController;
  entities: WidgetEntityHelpers;
  shared: { project: string; client: string; meeting: string; supplier: string };
  setShared: (kind: "project" | "client" | "meeting" | "supplier", path: string) => void;
  taskRowsForWidget: (item: LayoutItem) => TaskRecord[];
  scopedTasks: (item: LayoutItem, applyLimit?: boolean) => TaskRecord[];
  scopeLabel: (scope: TaskRecord["scope"]) => string;
  priorityLabel: (priority?: TaskRecord["priority"]) => string;
  onSearch: (value: string) => void;
  onCompleteTask: (task: TaskRecord, completed: boolean) => void;
  onOpenPath: (path: string) => void;
  onOpenYolo: (path: string) => void;
  onMigrateTask: (task: TaskRecord) => void;
  onScheduleTask: (task: TaskRecord) => void;
  onEditTask: (task: TaskRecord) => void;
  onAddTask: () => void;
  onRetry: () => void;
  memoDraft: string;
  onMemoInput: (value: string) => void;
  onMemoKeydown: (event: KeyboardEvent) => void;
  onMemoSubmit: () => void;
  onMemoOpenFile: () => void;
  onMemoYolo: () => void;
  registerMemoTextarea: (node: HTMLTextAreaElement) => void;
  isScheduleOverview: (item: LayoutItem) => boolean;
  calendarMonthLabel: (item: LayoutItem) => string;
  calendarCells: (item: LayoutItem) => MonthCalendarCell[];
  calendarSelected: (item: LayoutItem) => string;
  calendarSelectedLabel: (item: LayoutItem) => string;
  calendarEntriesForDate: (item: LayoutItem, date: string) => CalendarEntry[];
  calendarDotClass: (entry: CalendarEntry) => string;
  calendarAgenda: (item: LayoutItem) => AgendaGroup[];
  calendarIntegration: { state: string; title: string };
  calendarTodayTasks: () => DayTask[];
  calendarToday: { day: number; label: string };
  onMoveMonth: (item: LayoutItem, offset: number) => void;
  onCalendarToday: (item: LayoutItem) => void;
  onSelectDate: (item: LayoutItem, date: string) => void;
  onOpenCalendarEntry: (entry: CalendarEntry) => void;
  onOpenCalendarIntegration: () => void;
}

export function taskListProps(ctx: WidgetRenderContext) {
  return {
    rows: ctx.taskRowsForWidget(ctx.item),
    count: ctx.scopedTasks(ctx.item).length,
    search: ctx.search,
    writesEnabled: ctx.writesEnabled,
    busy: ctx.busy,
    loaded: Boolean(ctx.snapshot.scannedAt),
    error: ctx.snapshot.refreshError ?? "",
    allowAdd: ctx.query !== "client-actions",
    scopeLabel: ctx.scopeLabel,
    priorityLabel: ctx.priorityLabel,
    onSearch: ctx.onSearch,
    onComplete: ctx.onCompleteTask,
    onOpen: ctx.onOpenPath,
    onMigrate: ctx.onMigrateTask,
    onSchedule: ctx.onScheduleTask,
    onEdit: ctx.onEditTask,
    onAdd: ctx.onAddTask,
    onRetry: ctx.onRetry
  };
}

export function memoProps(ctx: WidgetRenderContext) {
  return {
    draft: ctx.memoDraft,
    writesEnabled: ctx.writesEnabled,
    busy: ctx.busy,
    path: ctx.snapshot.memo.path,
    exists: ctx.snapshot.memo.exists,
    error: ctx.snapshot.memo.error ?? "",
    recent: ctx.snapshot.memo.recent,
    onInput: ctx.onMemoInput,
    onKeydown: ctx.onMemoKeydown,
    onSubmit: ctx.onMemoSubmit,
    onOpenFile: ctx.onMemoOpenFile,
    onYolo: ctx.onMemoYolo,
    registerTextarea: ctx.registerMemoTextarea
  };
}

export function scheduleMode(item: LayoutItem, isOverview: boolean): "overview" | "month" | "date" {
  if (item.widgetId === "core.calendar") return "date";
  return isOverview ? "overview" : "month";
}

export function scheduleProps(ctx: WidgetRenderContext) {
  const item = ctx.item;
  return {
    mode: scheduleMode(item, ctx.isScheduleOverview(item)),
    monthLabel: ctx.calendarMonthLabel(item),
    cells: ctx.calendarCells(item),
    selected: ctx.calendarSelected(item),
    selectedLabel: ctx.calendarSelectedLabel(item),
    emptyDetail: ctx.source === "meetings" ? "会议" : "截止任务",
    agenda: ctx.calendarAgenda(item),
    integrationState: ctx.calendarIntegration.state,
    integrationTitle: ctx.calendarIntegration.title,
    dateDay: ctx.calendarToday.day,
    dateLabel: ctx.calendarToday.label,
    dayTasks: ctx.calendarTodayTasks(),
    entriesForDate: (date: string) => ctx.calendarEntriesForDate(item, date),
    dotClass: ctx.calendarDotClass,
    onMoveMonth: (offset: number) => ctx.onMoveMonth(item, offset),
    onToday: () => ctx.onCalendarToday(item),
    onSelectDate: (date: string) => ctx.onSelectDate(item, date),
    onOpenEntry: ctx.onOpenCalendarEntry,
    onOpenPath: ctx.onOpenPath,
    onOpenIntegration: ctx.onOpenCalendarIntegration
  };
}

function emptySummary(message: string): SummaryRenderModel {
  return { model: null, emptyMessage: message, onShare: () => {}, onAnimalChange: () => {} };
}

/** Assembles the presentation model; the module only renders it. */
export function summaryProps(ctx: WidgetRenderContext) {
  const render = summaryRender(ctx);
  const model: SummaryModel | null = render.model;
  return {
    model,
    emptyMessage: render.emptyMessage,
    onOpen: () => { if (model) ctx.onOpenPath(model.path); },
    onYolo: () => { if (model) ctx.onOpenYolo(model.path); },
    onShare: render.onShare,
    onAnimalChange: render.onAnimalChange
  };
}

export function summaryRender(ctx: WidgetRenderContext): SummaryRenderModel {
  const item = ctx.item;
  const helpers = ctx.entities;
  if (ctx.source === "clients") {
    const client = helpers.selectedClient(item);
    if (!client) return emptySummary("请先用客户选择器选择客户。");
    return {
      model: {
        path: client.path,
        iconKind: "client",
        iconText: "C",
        name: client.name,
        subtitle: client.businessDomains || "未填写业务领域",
        badge: client.relationshipStatus || "未设置",
        fields: [
          { label: "机构类型", value: client.organizationType || "未设置" },
          { label: "关系状态", value: client.relationshipStatus || "未设置" },
          { label: "跟进日期", value: client.followupDate || "未安排" },
          { label: "开放项目", value: String(helpers.projectsForClient(client.path).length) },
          { label: "未完成行动", value: String(helpers.tasksForClient(client.path).length) },
          { label: "相关会议", value: String(helpers.meetingsForClient(client.path).length) }
        ],
        noteLabel: "客户摘要",
        noteText: client.detail || "尚未填写客户摘要。",
        shareLabel: "设为共享客户",
        sharedLabel: "当前共享客户",
        shared: ctx.shared.client === client.path,
        openLabel: "打开客户"
      },
      emptyMessage: "请先用客户选择器选择客户。",
      onShare: () => ctx.setShared("client", client.path),
      onAnimalChange: () => {}
    };
  }
  if (ctx.source === "meetings") {
    const meeting = helpers.selectedMeeting(item);
    if (!meeting) return emptySummary("请先选择会议。");
    return {
      model: {
        path: meeting.path,
        iconKind: "meeting",
        iconText: "M",
        name: meeting.name,
        subtitle: meeting.project || meeting.client || "未关联",
        badge: meeting.due || "未设置日期",
        fields: [
          { label: "状态", value: meeting.status || "未设置" },
          { label: "项目", value: meeting.project || "未关联" },
          { label: "客户", value: meeting.client || "未关联" },
          { label: "行动项", value: String(helpers.openTaskCountFor(meeting.path)) }
        ],
        shareLabel: "设为共享会议",
        shared: false,
        openLabel: "打开会议"
      },
      emptyMessage: "请先选择会议。",
      onShare: () => ctx.setShared("meeting", meeting.path),
      onAnimalChange: () => {}
    };
  }
  if (ctx.source === "suppliers") {
    const supplier = helpers.selectedSupplier(item);
    if (!supplier) return emptySummary("请先选择供应商。");
    return {
      model: {
        path: supplier.path,
        iconKind: "supplier",
        iconText: "S",
        name: supplier.name,
        subtitle: supplier.detail || supplier.related || "供应商",
        badge: supplier.status || "未设置",
        fields: [
          { label: "状态", value: supplier.status || "未设置" },
          { label: "关联", value: supplier.related || "未关联" },
          { label: "更新时间", value: supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleDateString("zh-CN") : "未知" }
        ],
        shareLabel: "设为共享供应商",
        shared: false,
        openLabel: "打开供应商"
      },
      emptyMessage: "请先选择供应商。",
      onShare: () => ctx.setShared("supplier", supplier.path),
      onAnimalChange: () => {}
    };
  }
  const project = helpers.selectedProject(item);
  if (!project) return emptySummary("请选择或配置一个项目。");
  const health = helpers.projectHealth(project);
  return {
    model: {
      path: project.path,
      iconKind: "project",
      iconText: projectAnimalEmoji(helpers.projectAnimalValue(project.path)) || "P",
      name: project.name,
      subtitle: helpers.projectClientLabel(project),
      badge: projectStatusLabel(project.status),
      fields: [
        { label: "客户", value: helpers.projectClientLabel(project) },
        { label: "类型", value: project.projectType || "未设置" },
        { label: "研制阶段", value: project.phase || "未设置" },
        { label: "任务", value: `${health.completed}/${health.completed + health.open} 已完成` },
        { label: "最近更新", value: helpers.projectUpdatedLabel(project) }
      ],
      noteLabel: "明确下一步",
      noteText: project.detail || "尚未填写明确下一步。",
      shareLabel: "设为共享项目",
      sharedLabel: "当前共享项目",
      shared: ctx.shared.project === project.path,
      openLabel: "打开项目",
      animal: { value: helpers.projectAnimalValue(project.path), options: PROJECT_ANIMALS }
    },
    emptyMessage: "请选择或配置一个项目。",
    onShare: () => ctx.setShared("project", project.path),
    onAnimalChange: (value: string) => helpers.setProjectAnimal(project.path, value)
  };
}
