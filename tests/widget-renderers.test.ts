import { describe, expect, it, vi } from "vitest";
import type { LayoutItem } from "../src/core/types";
import type { WorkbenchController, WorkbenchSnapshot } from "../src/ui/controller";
import type { ProjectEntity } from "../src/ui/widgets/widget-contracts";
import {
  memoProps,
  scheduleMode,
  scheduleProps,
  summaryProps,
  taskListProps,
  widgetRenderKind,
  type WidgetEntityHelpers,
  type WidgetRenderContext
} from "../src/ui/widgets/widget-props";

function item(patch: Partial<LayoutItem> = {}): LayoutItem {
  return { widgetId: "view.list", x: 0, y: 0, width: 6, height: 5, ...patch };
}

const project = {
  path: "projects/demo.md",
  name: "虚构项目",
  client: "虚构客户",
  projectType: "研制",
  phase: "初样",
  status: "推进中",
  detail: "下一步：核对夹具"
} as unknown as ProjectEntity;

const entities: WidgetEntityHelpers = {
  selectedProject: () => project,
  selectedClient: () => undefined,
  selectedMeeting: () => undefined,
  selectedSupplier: () => undefined,
  projectsForClient: () => [],
  tasksForClient: () => [],
  meetingsForClient: () => [],
  openTaskCountFor: () => 0,
  projectHealth: () => ({ completed: 2, open: 3 }),
  projectClientLabel: () => "虚构客户",
  projectUpdatedLabel: () => "2026-10-06",
  projectAnimalValue: () => "fox",
  setProjectAnimal: vi.fn()
};

function context(patch: Partial<WidgetRenderContext> = {}): WidgetRenderContext {
  const layout = patch.item ?? item();
  const snapshot = {
    scannedAt: 1,
    refreshError: "",
    memo: { path: "memo.md", exists: true, recent: [{ date: "2026-10-06", time: "09:00", text: "虚构速记" }] },
    calendar: { state: "ready", events: [] },
    tasks: [],
    projects: [project],
    clients: [],
    meetings: [],
    suppliers: []
  } as unknown as WorkbenchSnapshot;
  return {
    item: layout,
    source: "tasks",
    variant: "",
    query: "",
    key: "widget-key",
    busy: false,
    writesEnabled: true,
    search: "",
    snapshot,
    controller: {} as WorkbenchController,
    entities,
    shared: { project: "", client: "", meeting: "", supplier: "" },
    setShared: vi.fn(),
    taskRowsForWidget: () => [],
    scopedTasks: () => [],
    scopeLabel: () => "项目",
    priorityLabel: () => "普通",
    onSearch: vi.fn(),
    onCompleteTask: vi.fn(),
    onOpenPath: vi.fn(),
    onOpenYolo: vi.fn(),
    onMigrateTask: vi.fn(),
    onScheduleTask: vi.fn(),
    onEditTask: vi.fn(),
    onAddTask: vi.fn(),
    onRetry: vi.fn(),
    memoDraft: "草稿",
    onMemoInput: vi.fn(),
    onMemoKeydown: vi.fn(),
    onMemoSubmit: vi.fn(),
    onMemoOpenFile: vi.fn(),
    onMemoYolo: vi.fn(),
    registerMemoTextarea: vi.fn(),
    isScheduleOverview: () => false,
    calendarMonthLabel: () => "2026年10月",
    calendarCells: () => [],
    calendarSelected: () => "2026-10-06",
    calendarSelectedLabel: () => "10月6日",
    calendarEntriesForDate: () => [],
    calendarDotClass: () => "task",
    calendarAgenda: () => [],
    calendarIntegration: { state: "ready", title: "打开 Full Calendar" },
    calendarTodayTasks: () => [],
    calendarToday: { day: 6, label: "十月 星期二" },
    onMoveMonth: vi.fn(),
    onCalendarToday: vi.fn(),
    onSelectDate: vi.fn(),
    onOpenCalendarEntry: vi.fn(),
    onOpenCalendarIntegration: vi.fn(),
    ...patch
  };
}

describe("widget render registry", () => {
  it("maps migrated widget ids to their module", () => {
    expect(widgetRenderKind(item({ widgetId: "tasks.list" }), "tasks", "")).toBe("task-list");
    expect(widgetRenderKind(item({ widgetId: "projects.tasks-list" }), "tasks", "")).toBe("task-list");
    expect(widgetRenderKind(item({ widgetId: "view.list" }), "tasks", "")).toBe("task-list");
    expect(widgetRenderKind(item({ widgetId: "capture.memo" }), "mixed", "")).toBe("memo");
    expect(widgetRenderKind(item({ widgetId: "tasks.calendar" }), "tasks", "")).toBe("schedule");
    expect(widgetRenderKind(item({ widgetId: "view.calendar" }), "mixed", "")).toBe("schedule");
    expect(widgetRenderKind(item({ widgetId: "core.calendar" }), "tasks", "")).toBe("schedule");
    expect(widgetRenderKind(item({ widgetId: "projects.summary" }), "projects", "")).toBe("project-summary");
    expect(widgetRenderKind(item({ widgetId: "view.detail" }), "projects", "")).toBe("project-summary");
  });

  it("leaves variant and legacy branches to the host", () => {
    expect(widgetRenderKind(item({ widgetId: "view.list" }), "projects", "")).toBeUndefined();
    expect(widgetRenderKind(item({ widgetId: "view.list" }), "tasks", "project-matrix")).toBeUndefined();
    expect(widgetRenderKind(item({ widgetId: "tasks.today" }), "tasks", "")).toBeUndefined();
    expect(widgetRenderKind(item({ widgetId: "core.diagnostics" }), "tasks", "")).toBeUndefined();
  });

  it("keeps task list behaviour for the client action variant", () => {
    const props = taskListProps(context({ query: "client-actions" }));
    expect(props.allowAdd).toBe(false);
    expect(taskListProps(context()).allowAdd).toBe(true);
  });

  it("passes memo state and callbacks without touching the vault", () => {
    const onMemoOpenFile = vi.fn();
    const props = memoProps(context({ onMemoOpenFile }));
    expect(props.draft).toBe("草稿");
    expect(props.path).toBe("memo.md");
    expect(props.exists).toBe(true);
    expect(props.recent).toHaveLength(1);
    props.onOpenFile();
    expect(onMemoOpenFile).toHaveBeenCalledTimes(1);
  });

  it("selects the calendar mode per widget id and preset", () => {
    expect(scheduleMode(item({ widgetId: "core.calendar" }), true)).toBe("date");
    expect(scheduleMode(item({ widgetId: "tasks.calendar" }), true)).toBe("overview");
    expect(scheduleMode(item({ widgetId: "tasks.calendar" }), false)).toBe("month");
    const props = scheduleProps(context({ calendarAgenda: () => [] }));
    expect(props.mode).toBe("month");
    expect(props.monthLabel).toBe("2026年10月");
    expect(props.entriesForDate("2026-10-06")).toEqual([]);
  });

  it("assembles a shareable project summary model", () => {
    const setShared = vi.fn();
    const props = summaryProps(context({ source: "projects", shared: { project: "", client: "", meeting: "", supplier: "" }, setShared }));
    expect(props.model?.name).toBe("虚构项目");
    expect(props.model?.iconText).toBe("🦊");
    expect(props.model?.fields).toContainEqual({ label: "任务", value: "2/5 已完成" });
    expect(props.model?.shared).toBe(false);
    props.onShare();
    expect(setShared).toHaveBeenCalledWith("project", "projects/demo.md");
    props.onAnimalChange("owl");
    expect(entities.setProjectAnimal).toHaveBeenCalledWith("projects/demo.md", "owl");
  });

  it("marks an already shared project and falls back to an empty state", () => {
    const props = summaryProps(context({ source: "projects", shared: { project: "projects/demo.md", client: "", meeting: "", supplier: "" } }));
    expect(props.model?.shared).toBe(true);
    expect(props.model?.sharedLabel).toBe("当前共享项目");
    const empty = summaryProps(context({ source: "clients" }));
    expect(empty.model).toBeNull();
    expect(empty.emptyMessage).toBe("请先用客户选择器选择客户。");
  });
});
