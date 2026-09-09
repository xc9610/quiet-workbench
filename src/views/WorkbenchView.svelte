<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { Platform, setIcon } from "obsidian";
  import type { EntityKind, LayoutItem, TaskRecord } from "../core/types";
  import type {
    AddProjectTaskInput,
    CreateEntityInput,
    CreateNoteInput,
    EntitySummary,
    WorkbenchController,
    WorkbenchSnapshot
  } from "../ui/controller";
  import { EMPTY_SNAPSHOT } from "../ui/controller";
  import { formatDate } from "../services/template-service";
  import type { MeetingMigrationBatchResult } from "../services/meeting-migration-service";
  import type { KnowledgePublicationPreview } from "../services/knowledge-publishing-service";
  import { getDefaultLayouts, layoutItemKey } from "../core/layout";
  import {
    cloneLayoutItems,
    moveVisibleLayoutItem,
    patchLayoutItem,
    recordLayoutHistory,
    removeLayoutItem
  } from "../core/layout-draft";
  import { legacySceneItems, type SceneId } from "../core/workbench-scenes";
  import {
    clampSpan,
    clampRowSpan,
    computeOrderedGridColumns,
    itemCols,
    itemRows,
    legacyHeightToRows,
    legacyWidthToCols,
    normalizeOrderedItems,
    recommendedRows
  } from "../core/ordered-grid";
  import { BUILTIN_WIDGETS } from "../core/widget-registry";
  import {
    defaultConfigForType,
    getWidgetPreset,
    presetsForType,
    type WidgetDataSource,
    type WidgetTypeId
  } from "../core/widget-model";
  import {
    activeFocusFilterCount,
    DEFAULT_FOCUS_FILTERS,
    filterFocusTasks,
    resolveEntityReference,
    type FocusFilters,
    type FocusQuickFilter,
    type FocusTaskRecord,
    type FocusTaskStatus
  } from "../domain/focus";
  import {
    calculateProjectHealth,
    clientFollowupBucket,
    dateAfter,
    effectiveTaskDate,
    isRecurringTask,
    isWaitingTask,
    taskListRows,
    taskQuadrant,
    taskTimeBucket,
    type TaskQuadrant,
    type TaskTimeBucket
  } from "../domain/widget-data";
  import { selectHeroCopy, type HeroCopy, type HeroCopyContext } from "../core/hero-copy";
  import { buildHeroContext, buildHeroMetrics, type HeroMetric } from "../domain/hero-metrics";
  import { activityStats, buildActivityCalendar } from "../domain/activity";
  import { buildMonthCalendar, calendarDateLabel, calendarMonthLabel, shiftCalendarMonth, type MonthCalendarCell } from "../domain/calendar";
  import {
    buildMeetingEntries,
    buildScheduleEntries,
    buildTaskDeadlineEntries,
    groupScheduleAgenda,
    type CalendarAgendaGroup,
    type CalendarEntry
  } from "../domain/calendar-entries";
  import LayoutEditorBar from "../ui/LayoutEditorBar.svelte";
  import SearchableSelect from "../ui/SearchableSelect.svelte";
  import type { SearchableOption } from "../ui/searchable-select";
  import { DEFAULT_PROJECT_NOTE_FOLDER } from "../domain/note";

  export let controller: WorkbenchController;

  type DialogKind = "note" | "entity" | "task" | "task-edit" | "schedule" | "migrate" | "knowledge" | "yolo-preview" | null;
  const UI_VERSION = "0.8.12";
  const DEFAULT_NOTE_FOLDER = controller.settings.solutionAssetsFolder || DEFAULT_PROJECT_NOTE_FOLDER;

  interface EntityDraft {
    kind: Exclude<EntityKind, "knowledge">;
    name: string;
    relatedClient: string;
    relatedProject: string;
    date: string;
    startTime: string;
    endTime: string;
  }

  interface CalendarViewState {
    month: string;
    selected: string;
  }

  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let activeScene: SceneId = (controller.settings.activeWorkbenchLayout as SceneId) || "workbench";
  let items: LayoutItem[] = loadScene(activeScene);
  let busy = false;
  let message = "";
  let dialog: DialogKind = null;
  let noteTitle = "";
  let noteFolder = DEFAULT_NOTE_FOLDER;
  let noteBody = "";
  let noteClient = "";
  let noteProject = "";
  let noteTitleInput: HTMLInputElement;
  let entityKind: Exclude<EntityKind, "knowledge"> = "project";
  let entityName = "";
  let relatedClient = "";
  let relatedProject = "";
  let entityDate = formatDate(new Date(), "YYYY-MM-DD");
  let entityStartTime = "";
  let entityEndTime = "";
  let entityTemplatePreview = "";
  let projectPath = "";
  let taskText = "";
  let taskDue = "";
  let taskScheduled = "";
  let taskPriority: TaskRecord["priority"] = "normal";
  let selectedTask: TaskRecord | undefined;
  let taskEditReason = "";
  let migrationTarget = "";
  let migrationTasks: TaskRecord[] = [];
  let migrationBatch: MeetingMigrationBatchResult | undefined;
  let selectedKnowledgePath = "";
  let knowledgeStatus = "待处理";
  let knowledgeProject = "";
  let knowledgePublishTitle = "";
  let knowledgePublication: KnowledgePublicationPreview | undefined;
  let yoloPrompt = "";
  let yoloPath = "";
  let entityStack: EntityDraft[] = [];
  let layoutUndo: LayoutItem[][] = [];
  let focusFilterStates: Record<string, FocusFilters> = {};
  let focusPersistQueue: Promise<void> = Promise.resolve();
  let focusFilterInstances: string[] = [];
  let showClientPicker = false;
  let clientSearch = "";
  let draftClients: string[] = [];
  let clientCursor = 0;
  let memoDraft = "";
  let memoInput: HTMLTextAreaElement;
  let layoutEditMode = false;
  let layoutDirty = false;
  let layoutOriginalItems: LayoutItem[] = [];
  let showWidgetLibrary = false;
  let widgetLibrarySearch = "";
  let widgetLibraryPack: "all" | "view" | "control" | "capture" = "all";
  let selectedWidgetType = "";
  let visibleWidgetLibraryItems = BUILTIN_WIDGETS.filter(() => true);
  let editingWidget: LayoutItem | undefined;
  let editingConfig: Record<string, unknown> = {};
  let editingTitle = "";
  let editingCols = 1;
  let editingRows = 1;
  let sharedProjectPath = "";
  let sharedClientPath = "";
  let sharedMeetingPath = "";
  let sharedSupplierPath = "";
  let widgetSearch: Record<string, string> = {};
  let calendarViewStates: Record<string, CalendarViewState> = {};
  let isDesktop = !Platform.isMobile;
  let gridEl: HTMLDivElement;
  let gridColumnCount = 4;
  let gridResizeObserver: ResizeObserver | undefined;
  let unsubscribe = () => {};
  let heroMetrics: HeroMetric[] = [];
  let heroContext: HeroCopyContext = { overdue: 0, dueToday: 0, upcoming: 0, missingNext: 0 };
  let heroCopy: HeroCopy = { title: "今天，继续推进", subtitle: "先看清下一步，再把分散的信息带回项目。" };
  let heroStatus: { label: string; tone: "enabled" | "readonly" | "error" } = { label: "只读诊断", tone: "readonly" };

  $: heroContext = buildHeroContext(snapshot, formatDate(new Date(), "YYYY-MM-DD"));
  $: heroMetrics = buildHeroMetrics(heroContext);
  $: heroCopy = selectHeroCopy(controller.settings.hero, formatDate(new Date(), "YYYY-MM-DD"), heroContext);
  $: heroStatus = snapshot.diagnostics.some((item) => item.status === "error")
    ? { label: "诊断异常", tone: "error" }
    : controller.settings.writesEnabled
      ? { label: "写入已启用", tone: "enabled" }
      : { label: "只读诊断", tone: "readonly" };
  $: visibleWidgetLibraryItems = BUILTIN_WIDGETS
    .filter((widget) => widget.surfaces.includes("workbench"))
    .filter((widget) => widget.showInLibrary !== false)
    .filter((widget) => widgetLibraryPack === "all" || widget.libraryCategory === widgetLibraryPack)
    .filter((widget) => {
      const query = widgetLibrarySearch.trim().toLocaleLowerCase("zh-CN");
      return !query || `${widget.title} ${widget.description ?? ""} ${widget.id}`.toLocaleLowerCase("zh-CN").includes(query);
    });

  const widgetTitles: Record<string, string> = {
    ...Object.fromEntries(BUILTIN_WIDGETS.map((widget) => [widget.id, widget.title])),
    "core.quick-create": "快捷创建",
    "tasks.today": "今日焦点",
    "tasks.project": "项目任务",
    "core.calendar": "日程",
    "capture.memo": "速记",
    "projects.recent": "开放项目",
    "projects.status": "项目状态",
    "projects.milestones": "项目里程碑",
    "meetings.actions": "会议与行动项",
    "clients.list": "客户",
    "suppliers.list": "供应商",
    "knowledge.inbox": "知识收件箱",
    "knowledge.triage": "待沉淀与待读",
    "knowledge.project-links": "已关联项目",
    "knowledge.recent": "最近知识笔记",
    "core.diagnostics": "诊断"
  };

  function itemKey(item: LayoutItem): string {
    return layoutItemKey(item);
  }

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        setIcon(node, next);
      }
    };
  }

  function widgetTitle(item: LayoutItem): string {
    return item.title || getWidgetPreset(item.presetId)?.title || widgetTitles[item.widgetId] || item.widgetId;
  }

  function heroDate(): string {
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  }

  function focusFiltersVisible(item: LayoutItem): boolean {
    return focusFilterInstances.includes(itemKey(item));
  }

  function toggleFocusFilters(item: LayoutItem): void {
    const key = itemKey(item);
    focusFilterInstances = focusFilterInstances.includes(key)
      ? []
      : [key];
  }

  function closeFocusFilters(): void {
    focusFilterInstances = [];
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!focusFilterInstances.length || showClientPicker) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".qwb-focus-toolbar, .qwb-focus-filters")) return;
    closeFocusFilters();
  }

  function handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (showClientPicker) showClientPicker = false;
    else if (focusFilterInstances.length) closeFocusFilters();
    else if (layoutEditMode) cancelLayoutEditing();
  }

  async function clearFocusFilters(item: LayoutItem): Promise<void> {
    await persistFocusFilters(item, structuredClone(DEFAULT_FOCUS_FILTERS));
  }

  function loadScene(sceneId: SceneId): LayoutItem[] {
    const saved = controller.settings.layouts.find(
      (layout) => layout.surface === "workbench" && layout.id === sceneId
    );
    const source = saved?.items ?? legacySceneItems(sceneId);
    return normalizeOrderedItems(source);
  }

  function hydrateFocusFilters(): void {
    const item = items.find((candidate) => candidate.widgetId === "tasks.today" || candidate.presetId === "tasks.today-focus");
    if (!item) return;
    const cacheKey = focusFilterCacheKey(item);
    focusFilterStates = { ...focusFilterStates, [cacheKey]: configuredFocusFilters(item) };
  }

  function focusFiltersForItem(item?: LayoutItem): FocusFilters {
    if (!item) return structuredClone(DEFAULT_FOCUS_FILTERS);
    return focusFilterStates[focusFilterCacheKey(item)] ?? configuredFocusFilters(item);
  }

  function configuredFocusFilters(item: LayoutItem): FocusFilters {
    const config = item?.config ?? {};
    const filters: FocusFilters = {
      quick: isFocusQuickFilter(config.quick) ? config.quick : DEFAULT_FOCUS_FILTERS.quick,
      scopes: Array.isArray(config.scopes)
        ? config.scopes.filter((value): value is TaskRecord["scope"] => ["project", "client", "meeting-draft"].includes(String(value)))
        : [],
      projectTypes: stringArray(config.projectTypes),
      clients: stringArray(config.clients),
      priorities: Array.isArray(config.priorities)
        ? config.priorities.filter((value): value is NonNullable<TaskRecord["priority"]> => ["highest", "high", "normal", "low", "lowest"].includes(String(value)))
        : [],
      statuses: Array.isArray(config.statuses)
        ? config.statuses.filter((value): value is FocusTaskStatus => value === "open" || value === "completed")
        : ["open"]
    };
    if (!filters.statuses.length) filters.statuses = ["open"];
    return filters;
  }

  function focusFilterCacheKey(item: LayoutItem): string {
    return `${activeScene}:${itemKey(item)}`;
  }

  function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
  }

  function isFocusQuickFilter(value: unknown): value is FocusQuickFilter {
    return value === "all" || value === "overdue" || value === "today" || value === "high";
  }

  async function persistFocusFilters(item: LayoutItem, next: FocusFilters): Promise<void> {
    const key = itemKey(item);
    const cacheKey = focusFilterCacheKey(item);
    focusFilterStates = { ...focusFilterStates, [cacheKey]: structuredClone(next) };
    items = items.map((candidate) => itemKey(candidate) === key
      ? { ...candidate, config: { ...(candidate.config ?? {}), ...structuredClone(next) } }
      : candidate);
    const sceneId = activeScene;
    const layoutSnapshot = items.map((candidate) => ({ ...candidate, config: candidate.config ? structuredClone(candidate.config) : undefined }));
    focusPersistQueue = focusPersistQueue
      .catch(() => undefined)
      .then(() => controller.saveLayout(sceneId, layoutSnapshot));
    await focusPersistQueue;
  }

  async function setQuickFilter(item: LayoutItem, quick: FocusQuickFilter): Promise<void> {
    await persistFocusFilters(item, { ...focusFiltersForItem(item), quick });
  }

  async function toggleFocusValue<K extends keyof Pick<FocusFilters, "scopes" | "projectTypes" | "priorities" | "statuses">>(item: LayoutItem, key: K, value: FocusFilters[K][number]): Promise<void> {
    const current = focusFiltersForItem(item);
    const selected = current[key] as Array<FocusFilters[K][number]>;
    const next = selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value];
    await persistFocusFilters(item, { ...current, [key]: next } as FocusFilters);
  }

  let focusPickerInstanceId = "";

  function openClientPicker(item: LayoutItem): void {
    focusPickerInstanceId = itemKey(item);
    draftClients = [...focusFiltersForItem(item).clients];
    clientSearch = "";
    clientCursor = 0;
    showClientPicker = true;
  }

  function toggleDraftClient(path: string): void {
    draftClients = draftClients.includes(path)
      ? draftClients.filter((entry) => entry !== path)
      : [...draftClients, path];
  }

  async function applyClientPicker(): Promise<void> {
    const item = items.find((candidate) => itemKey(candidate) === focusPickerInstanceId);
    showClientPicker = false;
    if (item) await persistFocusFilters(item, { ...focusFiltersForItem(item), clients: [...draftClients] });
  }

  function clientSearchResults() {
    const query = clientSearch.trim().toLocaleLowerCase("zh-CN");
    return snapshot.clients
      .filter((client) => !query || [client.name, client.path, ...(client.aliases ?? [])].some((value) => value.toLocaleLowerCase("zh-CN").includes(query)))
      .slice(0, 50);
  }

  function handleClientSearchKey(event: KeyboardEvent): void {
    const results = clientSearchResults();
    if (event.key === "Escape") {
      showClientPicker = false;
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      clientCursor = (clientCursor + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      toggleDraftClient(results[Math.min(clientCursor, results.length - 1)].path);
    }
  }

  function focusProjectTypes(): string[] {
    return [...new Set(snapshot.projects.map((project) => project.projectType).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  function resolveEntityPath(value: string | undefined, entities: WorkbenchSnapshot["clients"]): string | undefined {
    return resolveEntityReference(value, entities)?.path;
  }

  function resolveProject(value?: string) {
    return resolveEntityReference(value, snapshot.projects);
  }

  function taskClientPaths(task: TaskRecord): string[] {
    if (task.scope === "client") return [task.path];
    const sourceProject = task.scope === "project" ? snapshot.projects.find((project) => project.path === task.path) : undefined;
    const sourceMeeting = task.scope === "meeting-draft" ? snapshot.meetings.find((meeting) => meeting.path === task.path) : undefined;
    const relatedProject = sourceProject ?? resolveProject(sourceMeeting?.project);
    const values = [sourceMeeting?.client, relatedProject?.client].filter((value): value is string => Boolean(value));
    return [...new Set(values.flatMap(splitRelatedValues).map((value) => resolveEntityPath(value, snapshot.clients)).filter((value): value is string => Boolean(value)))];
  }

  function splitRelatedValues(value: string): string[] {
    const links = [...value.matchAll(/\[\[([^\]]+)\]\]/gu)].map((match) => `[[${match[1]}]]`);
    return links.length ? links : value.split(/[、,，;]/u).map((entry) => entry.trim()).filter(Boolean);
  }

  function focusTaskRecords(): FocusTaskRecord[] {
    return snapshot.tasks
      .filter((task) => !task.migrated)
      .filter((task) => task.scope !== "project" || snapshot.projects.some((project) => project.path === task.path))
      .map((task) => {
      const project = task.scope === "project"
        ? snapshot.projects.find((entry) => entry.path === task.path)
        : task.scope === "meeting-draft"
          ? resolveProject(snapshot.meetings.find((entry) => entry.path === task.path)?.project)
          : undefined;
        return { ...task, projectType: project?.projectType, clientIds: taskClientPaths(task) };
      });
  }

  function visibleFocusTasks(item: LayoutItem): FocusTaskRecord[] {
    return filterFocusTasks(focusTaskRecords(), focusFiltersForItem(item), formatDate(new Date(), "YYYY-MM-DD")).slice(0, 50);
  }

  function focusDate(task: TaskRecord): string {
    if (task.scheduled && task.due && task.scheduled !== task.due) return `计划 ${task.scheduled} · 截止 ${task.due}`;
    if (task.scheduled) return `计划 ${task.scheduled}`;
    if (task.due) return `截止 ${task.due}`;
    return "未安排日期";
  }

  function scopeLabel(scope: TaskRecord["scope"]): string {
    return { project: "项目", client: "客户", "meeting-draft": "会议草稿" }[scope];
  }

  function priorityLabel(priority?: TaskRecord["priority"]): string {
    return { highest: "最高", high: "高", normal: "普通", low: "低", lowest: "最低" }[priority ?? "normal"];
  }

  async function openFocusYolo(item: LayoutItem): Promise<void> {
    const rows = visibleFocusTasks(item);
    const prompt = [
      "请协助我处理以下 Asterism 今日焦点。先分析和给出编号建议，不要直接修改文件：",
      ...rows.map((task, index) => `${index + 1}. [${scopeLabel(task.scope)}] ${task.text}（${focusDate(task)}，来源：${task.sourceName}）`)
    ].join("\n");
    yoloPrompt = prompt;
    yoloPath = "";
    dialog = "yolo-preview";
  }

  async function submitQuickMemo(): Promise<void> {
    const value = memoDraft.trim();
    if (!value) return;
    const succeeded = await run(() => controller.appendQuickMemo(value), "速记已追加");
    if (succeeded) {
      memoDraft = "";
      await tick();
      memoInput?.focus();
    }
  }

  function handleMemoKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitQuickMemo();
  }

  async function openMemoYolo(): Promise<void> {
    const prompt = [
      "请整理当前 Asterism 速记文件中今天尚未处理的分条记录。",
      "先在对话中分类并给出预览，不要直接修改文件：",
      "1. 可执行任务：说明建议归属的项目或客户、日期和优先级。",
      "2. 日记内容：整理成保留原意的简短段落。",
      "3. 知识素材或暂时保留的记录。",
      "等待我确认后再执行任何写入。"
    ].join("\n");
    yoloPrompt = prompt;
    yoloPath = snapshot.memo.path;
    dialog = "yolo-preview";
  }

  async function confirmYolo(): Promise<void> {
    await navigator.clipboard.writeText(yoloPrompt);
    await controller.openYolo(yoloPath || undefined);
    dialog = null;
  }

  function widgetTypeIconName(id: string): string {
    return {
      "view.list": "list",
      "view.board": "columns-3",
      "view.calendar": "calendar",
      "view.quadrant": "grid-2x2",
      "view.timeline": "clock-3",
      "view.metrics": "gauge",
      "view.heatmap": "activity",
      "view.detail": "file-text",
      "view.relations": "git-fork",
      "control.selector": "mouse-pointer-2",
      "control.actions": "zap",
      "capture.memo": "notebook-pen"
    }[id] ?? "asterism-mark";
  }

  function heroStatusIcon(): string {
    if (heroStatus.tone === "error") return "alert-triangle";
    if (heroStatus.tone === "enabled") return "check";
    return "eye";
  }

  function nextWidgetY(): number {
    return items.reduce((bottom, item) => Math.max(bottom, item.y + (item.collapsed ? 1 : item.height)), 0);
  }

  async function addWidget(widgetId: string, presetId?: string): Promise<void> {
    const definition = BUILTIN_WIDGETS.find((widget) => widget.id === widgetId && widget.surfaces.includes("workbench"));
    if (!definition) throw new Error(`组件不可用于工作台：${widgetId}`);
    const preset = getWidgetPreset(presetId);
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const item: LayoutItem = {
      widgetId,
      instanceId: `${widgetId}-${suffix}`,
      title: preset?.title || definition.title,
      presetId: preset?.id,
      x: 0,
      y: nextWidgetY(),
      width: Math.min(12, Math.max(3, definition.defaultSize.width)),
      height: Math.max(2, definition.defaultSize.height),
      cols: legacyWidthToCols(definition.defaultSize.width),
      rows: recommendedRows({
        widgetId,
        x: 0,
        y: 0,
        width: definition.defaultSize.width,
        height: definition.defaultSize.height
      }),
      config: preset
        ? structuredClone(preset.config) as unknown as Record<string, unknown>
        : defaultWidgetConfig(widgetId)
    };
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = [...items, item];
    await persistLayoutDraft();
    showWidgetLibrary = false;
    selectedWidgetType = "";
  }

  function defaultWidgetConfig(widgetId: string): Record<string, unknown> | undefined {
    if (widgetId.startsWith("view.") || widgetId.startsWith("control.") || widgetId === "capture.memo") {
      return structuredClone(defaultConfigForType(widgetId as WidgetTypeId)) as unknown as Record<string, unknown>;
    }
    if (["projects.summary", "projects.health", "projects.progress", "projects.tasks-list", "projects.tasks-board", "projects.meetings", "projects.actions", "projects.waiting", "projects.risks", "projects.relations"].includes(widgetId)) {
      return { scopeMode: "shared", limit: 30, includeCompleted: false };
    }
    if (widgetId.startsWith("tasks.") || widgetId.startsWith("projects.")) {
      return { scopeMode: "all", limit: 30, includeCompleted: false, taskScopes: ["project", "client", "meeting-draft"] };
    }
    return undefined;
  }

  async function removeWidget(item: LayoutItem): Promise<void> {
    const key = itemKey(item);
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = removeLayoutItem(items, key);
    await persistLayoutDraft();
  }

  function openWidgetSettings(item: LayoutItem): void {
    editingWidget = item;
    editingTitle = widgetTitle(item);
    editingConfig = structuredClone(item.config ?? defaultWidgetConfig(item.widgetId) ?? {});
    editingCols = itemCols(item, gridColumnCount);
    editingRows = itemRows(item);
  }

  async function saveWidgetSettings(): Promise<void> {
    if (!editingWidget) return;
    const key = itemKey(editingWidget);
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = items.map((item) => itemKey(item) === key ? {
      ...item,
      title: editingTitle.trim() || widgetTitle(item),
      cols: clampSpan(editingCols),
      rows: clampRowSpan(editingRows),
      config: structuredClone(editingConfig)
    } : item);
    await persistLayoutDraft();
    editingWidget = undefined;
  }

  function editingTaskScopes(): string[] {
    const source = configSection(editingConfig, "source");
    const value = source.taskScopes ?? editingConfig.taskScopes;
    return Array.isArray(value) ? value.map(String) : [];
  }

  function toggleEditingTaskScope(scope: TaskRecord["scope"]): void {
    const current = editingTaskScopes();
    updateEditingSource({ taskScopes: current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope] });
  }

  function configString(item: LayoutItem, key: string): string {
    const section = ["scopeMode", "projectPath", "clientPath", "meetingPath", "supplierPath", "projectType", "taskScopes"].includes(key) ? "source" : "query";
    const nested = item.config?.[section];
    const value = nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)[key]
      : item.config?.[key];
    return typeof value === "string" ? value : "";
  }

  function configBoolean(item: LayoutItem, key: string, fallback = false): boolean {
    const nested = item.config?.query;
    const value = nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)[key]
      : item.config?.[key];
    return typeof value === "boolean" ? value : fallback;
  }

  function configLimit(item: LayoutItem): number {
    const value = configSection(item.config ?? {}, "query").limit ?? item.config?.limit;
    return typeof value === "number" && Number.isInteger(value) ? Math.max(1, Math.min(200, value)) : 30;
  }

  function scopeMode(item: LayoutItem): string {
    return configString(item, "scopeMode") || "all";
  }

  function configSection(config: Record<string, unknown>, key: "source" | "query" | "display"): Record<string, unknown> {
    const value = config[key];
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  function updateEditingSource(patch: Record<string, unknown>): void {
    editingConfig = { ...editingConfig, source: { ...configSection(editingConfig, "source"), ...patch } };
  }

  function updateEditingQuery(patch: Record<string, unknown>): void {
    editingConfig = { ...editingConfig, query: { ...configSection(editingConfig, "query"), ...patch } };
  }

  function dataSource(item: LayoutItem): WidgetDataSource {
    const value = configSection(item.config ?? {}, "source").kind;
    if (typeof value === "string") return value as WidgetDataSource;
    if (item.widgetId.startsWith("projects.")) return "projects";
    if (item.widgetId.startsWith("meetings.")) return "meetings";
    if (item.widgetId.startsWith("suppliers.")) return "suppliers";
    return "tasks";
  }

  function queryMode(item: LayoutItem): string {
    return configString(item, "mode");
  }

  function displayVariant(item: LayoutItem): string {
    const value = configSection(item.config ?? {}, "display").variant;
    return typeof value === "string" ? value : "";
  }

  function metricKind(item: LayoutItem): string {
    return configString(item, "metric");
  }

  function contextProjectPath(): string {
    if (snapshot.context.kind === "project" && snapshot.context.path) return snapshot.context.path;
    return snapshot.context.relatedProjects[0]?.path ?? "";
  }

  function scopedProjectPath(item: LayoutItem): string {
    const mode = scopeMode(item);
    if (mode === "fixed") return configString(item, "projectPath");
    if (mode === "context") return contextProjectPath();
    if (mode === "shared") return sharedProjectPath || contextProjectPath();
    return "";
  }

  function contextClientPath(): string {
    return snapshot.context.kind === "client" && snapshot.context.path ? snapshot.context.path : "";
  }

  function scopedClientPath(item: LayoutItem): string {
    const mode = scopeMode(item);
    if (mode === "fixed") return configString(item, "clientPath");
    if (mode === "context") return contextClientPath();
    if (mode === "shared") return sharedClientPath || contextClientPath();
    return configString(item, "clientPath");
  }

  function scopedClients(item: LayoutItem) {
    const clientPath = scopedClientPath(item);
    const relationshipStatus = configString(item, "relationshipStatus");
    const organizationType = configString(item, "organizationType");
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    return snapshot.clients
      .filter((client) => !clientPath || client.path === clientPath)
      .filter((client) => !relationshipStatus || client.relationshipStatus === relationshipStatus)
      .filter((client) => !organizationType || client.organizationType === organizationType)
      .filter((client) => !query || [client.name, client.path, ...(client.aliases ?? []), client.organizationType, client.businessDomains, client.relationshipStatus].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)))
      .slice(0, configLimit(item));
  }

  function selectedClient(item: LayoutItem) {
    const path = scopedClientPath(item);
    if (scopeMode(item) !== "all" && !path) return undefined;
    return snapshot.clients.find((client) => client.path === path) ?? scopedClients(item)[0];
  }

  function sharedClient() {
    return snapshot.clients.find((client) => client.path === sharedClientPath);
  }

  function contextMeetingPath(): string {
    return snapshot.context.kind === "meeting" && snapshot.context.path ? snapshot.context.path : "";
  }

  function scopedMeetingPath(item: LayoutItem): string {
    const mode = scopeMode(item);
    if (mode === "fixed") return configString(item, "meetingPath");
    if (mode === "context") return contextMeetingPath();
    if (mode === "shared") return sharedMeetingPath || contextMeetingPath();
    return configString(item, "meetingPath");
  }

  function scopedMeetings(item: LayoutItem) {
    const path = scopedMeetingPath(item);
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    return snapshot.meetings
      .filter((meeting) => !path || meeting.path === path)
      .filter((meeting) => !query || [meeting.name, meeting.path, meeting.project, meeting.client, meeting.status].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)))
      .sort((left, right) => (right.due ?? "").localeCompare(left.due ?? ""))
      .slice(0, configLimit(item));
  }

  function selectedMeeting(item: LayoutItem) {
    const path = scopedMeetingPath(item);
    return snapshot.meetings.find((meeting) => meeting.path === path) ?? scopedMeetings(item)[0];
  }

  function scopedSupplierPath(item: LayoutItem): string {
    const mode = scopeMode(item);
    if (mode === "fixed") return configString(item, "supplierPath");
    if (mode === "context" && snapshot.context.kind === "supplier") return snapshot.context.path ?? "";
    if (mode === "shared") return sharedSupplierPath || (snapshot.context.kind === "supplier" ? snapshot.context.path ?? "" : "");
    return configString(item, "supplierPath");
  }

  function scopedSuppliers(item: LayoutItem) {
    const path = scopedSupplierPath(item);
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    return snapshot.suppliers
      .filter((supplier) => !path || supplier.path === path)
      .filter((supplier) => !query || [supplier.name, supplier.path, supplier.status, supplier.related, supplier.detail].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)))
      .slice(0, configLimit(item));
  }

  function selectedSupplier(item: LayoutItem) {
    const path = scopedSupplierPath(item);
    return snapshot.suppliers.find((supplier) => supplier.path === path) ?? scopedSuppliers(item)[0];
  }

  function projectForTask(task: TaskRecord) {
    if (task.scope === "project") return snapshot.projects.find((project) => project.path === task.path);
    if (task.scope === "meeting-draft") return resolveProject(snapshot.meetings.find((meeting) => meeting.path === task.path)?.project);
    return undefined;
  }

  function scopedProjects(item: LayoutItem) {
    const clientMode = queryMode(item) === "client-projects";
    const fixedPath = clientMode ? "" : scopedProjectPath(item);
    const clientPath = clientMode ? scopedClientPath(item) : configString(item, "clientPath");
    const projectType = configString(item, "projectType");
    const status = configString(item, "status");
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    return snapshot.projects
      .filter((project) => !fixedPath || project.path === fixedPath)
      .filter((project) => !clientPath || resolveEntityPath(project.client, snapshot.clients) === clientPath)
      .filter((project) => !projectType || project.projectType === projectType)
      .filter((project) => !status || (project.status ?? "") === status)
      .filter((project) => !query || [project.name, project.path, project.client, project.projectType, project.status].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)))
      .slice(0, configLimit(item));
  }

  function scopedTasks(item: LayoutItem, applyLimit = true): TaskRecord[] {
    const clientMode = queryMode(item) === "client-actions";
    const projectPath = clientMode ? "" : scopedProjectPath(item);
    const clientPath = clientMode ? scopedClientPath(item) : configString(item, "clientPath");
    const projectType = configString(item, "projectType");
    const sourceTaskScopes = configSection(item.config ?? {}, "source").taskScopes;
    const taskScopes = Array.isArray(sourceTaskScopes) ? sourceTaskScopes.map(String) : Array.isArray(item.config?.taskScopes) ? item.config.taskScopes.map(String) : [];
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    const rows = snapshot.tasks
      .filter((task) => !task.migrated)
      .filter((task) => configBoolean(item, "includeCompleted") || !task.completed)
      .filter((task) => !taskScopes.length || taskScopes.includes(task.scope))
      .filter((task) => !projectPath || projectForTask(task)?.path === projectPath)
      .filter((task) => !clientPath || taskClientPaths(task).includes(clientPath))
      .filter((task) => !projectType || projectForTask(task)?.projectType === projectType)
      .filter((task) => !query || `${task.text} ${task.sourceName}`.toLocaleLowerCase("zh-CN").includes(query));
    return applyLimit ? rows.slice(0, configLimit(item)) : rows;
  }

  function selectedProject(item: LayoutItem) {
    return scopedProjects(item)[0] ?? snapshot.projects.find((project) => project.path === scopedProjectPath(item));
  }

  function sharedProject() {
    return snapshot.projects.find((project) => project.path === sharedProjectPath);
  }

  function projectClient(project: WorkbenchSnapshot["projects"][number]) {
    const path = resolveEntityPath(project.client, snapshot.clients);
    return path ? snapshot.clients.find((client) => client.path === path) : undefined;
  }

  function projectClientLabel(project: WorkbenchSnapshot["projects"][number]): string {
    return projectClient(project)?.name ?? project.client?.replace(/^\[\[|\]\]$/gu, "").split("|").at(-1) ?? "未关联客户";
  }

  function projectUpdatedLabel(project: WorkbenchSnapshot["projects"][number]): string {
    return project.updatedAt ? new Date(project.updatedAt).toLocaleDateString("zh-CN") : "未知";
  }

  function tasksForProject(path: string, includeCompleted = true): TaskRecord[] {
    return snapshot.tasks.filter((task) => projectForTask(task)?.path === path && (includeCompleted || !task.completed));
  }

  function meetingProjectPath(meetingPath: string): string | undefined {
    return resolveProject(snapshot.meetings.find((meeting) => meeting.path === meetingPath)?.project)?.path;
  }

  function meetingsForProject(path: string) {
    return snapshot.meetings.filter((meeting) => resolveProject(meeting.project)?.path === path);
  }

  function projectsForClient(path: string) {
    return snapshot.projects.filter((project) => resolveEntityPath(project.client, snapshot.clients) === path);
  }

  function tasksForClient(path: string): TaskRecord[] {
    const projectPaths = new Set(projectsForClient(path).map((project) => project.path));
    return snapshot.tasks.filter((task) => !task.completed && !task.migrated && (task.path === path || Boolean(projectForTask(task) && projectPaths.has(projectForTask(task)!.path))));
  }

  function meetingsForClient(path: string) {
    const projectPaths = new Set(projectsForClient(path).map((project) => project.path));
    return snapshot.meetings.filter((meeting) => resolveEntityPath(meeting.client, snapshot.clients) === path || Boolean(resolveProject(meeting.project) && projectPaths.has(resolveProject(meeting.project)!.path)));
  }

  function clientRowsForWidget(item: LayoutItem) {
    let rows = [...scopedClients(item)];
    if (queryMode(item) === "followups") {
      const { today, end } = dayRange(7);
      rows = rows
        .filter((client) => client.followupDate && client.followupDate <= end)
        .sort((left, right) => (left.followupDate ?? "").localeCompare(right.followupDate ?? ""));
    }
    return rows;
  }

  function clientStatusGroups(item: LayoutItem): Array<[string, WorkbenchSnapshot["clients"]]> {
    const groups = new Map<string, WorkbenchSnapshot["clients"]>();
    for (const client of scopedClients(item)) {
      const status = client.relationshipStatus || "未设置";
      groups.set(status, [...(groups.get(status) ?? []), client]);
    }
    return [...groups.entries()];
  }

  function clientFollowupLabel(client: WorkbenchSnapshot["clients"][number]): string {
    if (!client.followupDate) return "未安排跟进";
    const { today, end } = dayRange(7);
    const bucket = clientFollowupBucket(client.followupDate, today, end);
    const prefix = { overdue: "已逾期", today: "今天", week: "7 天内", later: "以后", unscheduled: "未安排" }[bucket];
    return `${prefix} · ${client.followupDate}`;
  }

  function clientRelationshipStatuses(): string[] {
    return [...new Set(snapshot.clients.map((client) => client.relationshipStatus).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  function clientOrganizationTypes(): string[] {
    return [...new Set(snapshot.clients.map((client) => client.organizationType).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  function dayRange(days: number): { today: string; end: string } {
    const today = formatDate(new Date(), "YYYY-MM-DD");
    return { today, end: dateAfter(today, days) };
  }

  function tasksInBucket(item: LayoutItem, bucket: TaskTimeBucket): TaskRecord[] {
    const { today, end } = dayRange(7);
    return scopedTasks(item).filter((task) => taskTimeBucket(task, today, end) === bucket);
  }

  function tasksInQuadrant(item: LayoutItem, quadrant: TaskQuadrant): TaskRecord[] {
    const { today } = dayRange(0);
    return scopedTasks(item).filter((task) => taskQuadrant(task, today, dateAfter(today, 2)) === quadrant);
  }

  function groupTasksByDate(item: LayoutItem): Array<[string, TaskRecord[]]> {
    const groups = new Map<string, TaskRecord[]>();
    for (const task of scopedTasks(item)) {
      const date = effectiveTaskDate(task) ?? "未安排";
      groups.set(date, [...(groups.get(date) ?? []), task]);
    }
    return [...groups.entries()].sort(([left], [right]) => (left === "未安排" ? 1 : right === "未安排" ? -1 : left.localeCompare(right)));
  }

  function calendarState(item: LayoutItem, saved?: CalendarViewState): CalendarViewState {
    if (saved) return saved;
    const today = formatDate(new Date(), "YYYY-MM-DD");
    return { month: today.slice(0, 7), selected: today };
  }

  function calendarCells(item: LayoutItem, saved?: CalendarViewState): MonthCalendarCell[] {
    const state = calendarState(item, saved);
    return buildMonthCalendar(state.month, formatDate(new Date(), "YYYY-MM-DD"));
  }

  function setCalendarDate(item: LayoutItem, date: string): void {
    calendarViewStates = {
      ...calendarViewStates,
      [itemKey(item)]: { month: date.slice(0, 7), selected: date }
    };
  }

  function moveCalendarMonth(item: LayoutItem, offset: number): void {
    const current = calendarState(item, calendarViewStates[itemKey(item)]);
    const month = shiftCalendarMonth(current.month, offset);
    const today = formatDate(new Date(), "YYYY-MM-DD");
    setCalendarDate(item, month === today.slice(0, 7) ? today : `${month}-01`);
  }

  function resetCalendarToday(item: LayoutItem): void {
    setCalendarDate(item, formatDate(new Date(), "YYYY-MM-DD"));
  }

  function calendarEntries(item: LayoutItem): CalendarEntry[] {
    const today = formatDate(new Date(), "YYYY-MM-DD");
    const source = dataSource(item);
    const meetings = scopedMeetings(item);
    if (source === "meetings") return buildMeetingEntries(meetings);
    const tasks = scopedTasks(item, false);
    if (source === "mixed") return buildScheduleEntries(tasks, meetings, snapshot.calendar.events);
    return buildTaskDeadlineEntries(tasks, today);
  }

  function isScheduleOverview(item: LayoutItem): boolean {
    return item.presetId === "schedule.overview" || dataSource(item) === "mixed";
  }

  function scheduleAgendaGroups(item: LayoutItem): CalendarAgendaGroup[] {
    return groupScheduleAgenda(calendarEntries(item), formatDate(new Date(), "YYYY-MM-DD"), 7);
  }

  function calendarEntriesForDate(item: LayoutItem, date: string): CalendarEntry[] {
    return calendarEntries(item).filter((entry) => entry.date === date);
  }

  function calendarDotClass(entry: CalendarEntry): string {
    if (entry.completed) return "completed";
    if (entry.overdue) return "overdue";
    return entry.kind;
  }

  async function openCalendarEntry(entry: CalendarEntry): Promise<void> {
    if (entry.path) await controller.openPath(entry.path);
    else await controller.openCalendar();
  }

  async function useCalendarIntegration(): Promise<void> {
    if (snapshot.calendar.state === "authorization-required") {
      await controller.authorizeCalendar();
      message = "Full Calendar 已连接";
      return;
    }
    await controller.openCalendar();
  }

  function calendarIntegrationTitle(): string {
    if (snapshot.calendar.state === "ready") return "打开 Full Calendar";
    if (snapshot.calendar.state === "authorization-required") return "连接 Full Calendar";
    if (snapshot.calendar.state === "unavailable") return "Full Calendar 未启用";
    return "重新连接 Full Calendar";
  }

  function taskRowsForWidget(item: LayoutItem): TaskRecord[] {
    const rows = scopedTasks(item, false);
    const { today, end } = dayRange(7);
    const configuredMode = queryMode(item);
    const mode = item.widgetId === "tasks.inbox" ? "inbox"
      : item.widgetId === "tasks.waiting" || item.widgetId === "projects.waiting" ? "waiting"
        : item.widgetId === "tasks.week" ? "week"
          : item.widgetId === "tasks.recurring" ? "recurring"
            : configuredMode || "all";
    return taskListRows(rows, mode, today, end, configLimit(item));
  }

  function projectRowsForWidget(item: LayoutItem) {
    const mode = queryMode(item);
    let rows = [...scopedProjects(item)];
    if (mode === "risks") rows = rows.filter((project) => projectHealth(project).level !== "healthy");
    if (mode === "milestones") rows = rows.filter((project) => project.due).sort((left, right) => (left.due ?? "").localeCompare(right.due ?? ""));
    if (mode === "recent") rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    return rows;
  }

  function projectTaskGroups(item: LayoutItem): Array<[WorkbenchSnapshot["projects"][number], TaskRecord[]]> {
    return scopedProjects(item)
      .map((project) => [project, tasksForProject(project.path, configBoolean(item, "includeCompleted"))] as [WorkbenchSnapshot["projects"][number], TaskRecord[]])
      .filter(([, tasks]) => tasks.length > 0);
  }

  function clientTaskGroups(item: LayoutItem): Array<[WorkbenchSnapshot["clients"][number], TaskRecord[]]> {
    return snapshot.clients
      .map((client) => [client, scopedTasks(item).filter((task) => taskClientPaths(task).includes(client.path))] as [WorkbenchSnapshot["clients"][number], TaskRecord[]])
      .filter(([, tasks]) => tasks.length > 0);
  }

  function workloadDays(item: LayoutItem): Array<{ date: string; count: number; width: number }> {
    const { today } = dayRange(0);
    const counts = Array.from({ length: 7 }, (_, index) => {
      const date = dateAfter(today, index);
      return { date, count: scopedTasks(item).filter((task) => effectiveTaskDate(task) === date).length };
    });
    const max = Math.max(1, ...counts.map((entry) => entry.count));
    return counts.map((entry) => ({ ...entry, width: Math.round((entry.count / max) * 100) }));
  }

  function activityCalendar() {
    return buildActivityCalendar(snapshot.activity);
  }

  function activitySummary() {
    return activityStats(snapshot.activity);
  }

  function relatedKnowledge(projectPath: string) {
    const project = snapshot.projects.find((entry) => entry.path === projectPath);
    if (!project) return [];
    return snapshot.knowledge.filter((entry) => resolveProject(entry.related)?.path === projectPath || entry.related?.includes(project.name));
  }

  function projectHealth(project: WorkbenchSnapshot["projects"][number]) {
    return calculateProjectHealth(project, tasksForProject(project.path), formatDate(new Date(), "YYYY-MM-DD"));
  }

  function healthLabel(level: ReturnType<typeof projectHealth>["level"]): string {
    return { healthy: "健康", attention: "需关注", risk: "有风险", unknown: "信息不足" }[level];
  }

  function projectStatusGroups(item: LayoutItem): Array<[string, WorkbenchSnapshot["projects"]]> {
    const groups = new Map<string, WorkbenchSnapshot["projects"]>();
    for (const project of scopedProjects(item)) {
      const status = project.status || project.phase || "未设置";
      groups.set(status, [...(groups.get(status) ?? []), project]);
    }
    return [...groups.entries()];
  }

  function knowledgeHint(widgetId: string): string {
    return {
      "knowledge.inbox": "尚未分流的收件箱内容",
      "knowledge.triage": "需要沉淀为长期知识或安排阅读",
      "knowledge.project-links": "已经连接到具体项目的知识",
      "knowledge.recent": "按最近更新时间查看全部知识"
    }[widgetId] ?? "知识处理队列";
  }

  function dialogTitle(kind: DialogKind): string {
    if (!kind) return "工作流";
    return { note: "新建项目笔记", entity: "新建条目", task: "添加项目任务", "task-edit": "调整任务", schedule: "安排到日程", migrate: "迁移会议行动项", knowledge: "处理知识", "yolo-preview": "YOLO 处理预览" }[kind];
  }

  function entityTargetFolder(): string {
    return {
      project: controller.settings.projectFolder,
      client: controller.settings.clientFolder,
      meeting: controller.settings.meetingFolder,
      supplier: controller.settings.supplierFolder
    }[entityKind];
  }

  function relationOptions(rows: readonly EntitySummary[], kindLabel: string): SearchableOption[] {
    return rows.map((entry) => ({
      value: entry.path,
      label: entry.name,
      description: [kindLabel, entry.status || entry.phase, compactRelationName(entry.client || entry.project)]
        .filter(Boolean)
        .join(" · "),
      keywords: [entry.path, entry.client, entry.project, entry.projectType, entry.organizationType, entry.relationshipStatus]
        .filter((value): value is string => Boolean(value))
    }));
  }

  function compactRelationName(value?: string): string {
    return value?.replace(/^\[\[/u, "").replace(/\]\]$/u, "").replace(/\.md$/iu, "").split("/").pop() ?? "";
  }

  function clientOptions(): SearchableOption[] {
    return relationOptions(snapshot.clients, "客户");
  }

  function projectOptions(): SearchableOption[] {
    return relationOptions(snapshot.projects, "项目");
  }

  function meetingOptions(): SearchableOption[] {
    return relationOptions(snapshot.meetings, "会议");
  }

  function supplierOptions(): SearchableOption[] {
    return relationOptions(snapshot.suppliers, "供应商");
  }

  function migrationOptions(): SearchableOption[] {
    return [...projectOptions(), ...clientOptions()];
  }

  function relationLabel(path: string): string {
    return [...snapshot.projects, ...snapshot.clients, ...snapshot.meetings, ...snapshot.suppliers]
      .find((entry) => entry.path === path)?.name ?? path;
  }

  function noteTargetPath(): string {
    const folder = noteFolder.trim().replace(/\/+$/u, "");
    return `${folder ? `${folder}/` : ""}${noteTitle.trim() || "未命名"}.md`;
  }

  function noteFolderSuggestions(): string[] {
    return [...new Set([
      DEFAULT_NOTE_FOLDER,
      "20_技术_Technology/90_待整理_Inbox",
      controller.settings.knowledgeFolder,
      controller.settings.formalKnowledgeFolder,
      controller.settings.projectFolder,
      controller.settings.clientFolder,
      controller.settings.meetingFolder
    ].filter(Boolean))];
  }

  function enabled(item: LayoutItem): boolean {
    const prefix = (item.presetId || item.widgetId).split(".")[0];
    const packByPrefix: Record<string, string> = {
      projects: "projects",
      clients: "clients",
      suppliers: "suppliers",
      meetings: "meetings",
      tasks: "tasks",
      knowledge: "knowledge"
    };
    const pack = packByPrefix[prefix];
    return !pack || controller.settings.enabledPacks[pack] !== false;
  }

  function itemStyle(item: LayoutItem): string {
    if (!isDesktop) return "";
    const cols = itemCols(item, gridColumnCount);
    const rows = item.collapsed ? 1 : itemRows(item);
    return `--cols:${cols};--rows:${rows};grid-column:span ${cols};grid-row:span ${rows}`;
  }

  async function persistLayoutDraft(): Promise<void> {
    items = normalizeOrderedItems(items);
    if (layoutEditMode) {
      layoutDirty = true;
      return;
    }
    await controller.saveLayout(activeScene, items);
  }

  function beginLayoutEditing(): void {
    layoutOriginalItems = cloneLayoutItems(items);
    layoutUndo = [];
    layoutDirty = false;
    layoutEditMode = true;
  }

  async function saveLayoutEditing(): Promise<void> {
    if (layoutDirty) await controller.saveLayout(activeScene, items);
    layoutOriginalItems = [];
    layoutUndo = [];
    layoutDirty = false;
    layoutEditMode = false;
  }

  function cancelLayoutEditing(): void {
    if (layoutOriginalItems.length) items = cloneLayoutItems(layoutOriginalItems);
    layoutOriginalItems = [];
    layoutUndo = [];
    layoutDirty = false;
    layoutEditMode = false;
    editingWidget = undefined;
    showWidgetLibrary = false;
  }

  async function moveItem(instanceId: string, offset: -1 | 1): Promise<void> {
    const visibleKeys = items.filter((item) => !item.hidden && enabled(item)).map(itemKey);
    const next = moveVisibleLayoutItem(items, visibleKeys, instanceId, offset);
    if (next === items) return;
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = next;
    await persistLayoutDraft();
  }

  function updateGridMetrics(): void {
    if (!gridEl || !isDesktop) return;
    const style = getComputedStyle(gridEl);
    const gap = parseFloat(style.columnGap) || 12;
    const width = gridEl.getBoundingClientRect().width;
    if (width <= 0) return;
    gridColumnCount = computeOrderedGridColumns(width, gap);
    const columnUnit = Math.max(40, (width - gap * (gridColumnCount - 1)) / gridColumnCount);
    const rowUnit = Math.max(96, Math.min(144, Math.round(columnUnit * .4)));
    gridEl.style.setProperty("--qwb-cols", String(gridColumnCount));
    gridEl.style.setProperty("--qwb-row-h", `${rowUnit}px`);
  }

  async function setItemState(instanceId: string, patch: Partial<LayoutItem>): Promise<void> {
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = patchLayoutItem(items, instanceId, patch);
    await persistLayoutDraft();
  }

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    busy = true;
    message = "";
    try {
      await action();
      message = success;
      return true;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      busy = false;
    }
  }

  function openCreate(kind: Exclude<EntityKind, "knowledge">, contextPath = "", contextKind: "project" | "client" = "project"): void {
    entityKind = kind;
    entityName = "";
    relatedClient = contextKind === "client" && (kind === "project" || kind === "meeting") ? contextPath : "";
    relatedProject = contextKind === "project" && kind === "meeting" ? contextPath : "";
    entityDate = formatDate(new Date(), "YYYY-MM-DD");
    entityStartTime = "";
    entityEndTime = "";
    entityTemplatePreview = "";
    entityStack = [];
    dialog = "entity";
  }

  function openNote(): void {
    noteTitle = "";
    noteFolder = DEFAULT_NOTE_FOLDER;
    noteBody = "";
    noteClient = "";
    noteProject = "";
    dialog = "note";
    void tick().then(() => noteTitleInput?.focus());
  }

  function beginNestedEntity(kind: "client" | "project"): void {
    entityStack = [...entityStack, {
      kind: entityKind,
      name: entityName,
      relatedClient,
      relatedProject,
      date: entityDate,
      startTime: entityStartTime,
      endTime: entityEndTime
    }];
    entityKind = kind;
    entityName = "";
    relatedClient = "";
    relatedProject = "";
    entityStartTime = "";
    entityEndTime = "";
    entityTemplatePreview = "";
  }

  async function previewEntityTemplate(): Promise<void> {
    if (!entityName.trim()) return;
    const result = await controller.previewEntity({
      kind: entityKind,
      name: entityName.trim(),
      relatedClient: relatedClient || undefined,
      relatedProject: relatedProject || undefined,
      date: entityDate || undefined,
      startTime: entityKind === "meeting" ? entityStartTime || undefined : undefined,
      endTime: entityKind === "meeting" ? entityEndTime || undefined : undefined,
      openAfterCreate: false
    });
    entityTemplatePreview = `${result.path}\n\n${result.content}`;
  }

  function openTask(path?: string): void {
    projectPath = path || "";
    taskText = "";
    taskDue = "";
    taskPriority = "normal";
    dialog = "task";
  }

  function openBasicTaskEdit(task: TaskRecord): void {
    selectedTask = task;
    taskDue = task.due ?? "";
    taskPriority = task.priority ?? "normal";
    taskEditReason = "";
    dialog = "task-edit";
  }

  async function openTaskEdit(task: TaskRecord): Promise<void> {
    if (!controller.tasksIntegrationAvailable()) {
      openBasicTaskEdit(task);
      return;
    }
    busy = true;
    message = "";
    try {
      const result = await controller.editTaskWithTasks(task);
      if (result === "committed") message = "任务已通过 Tasks 更新";
      else if (result === "unavailable") openBasicTaskEdit(task);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  function openTaskSchedule(task: TaskRecord): void {
    selectedTask = task;
    taskScheduled = task.scheduled?.slice(0, 10) || formatDate(new Date(), "YYYY-MM-DD");
    dialog = "schedule";
  }

  async function submitTaskSchedule(): Promise<void> {
    if (!selectedTask || !taskScheduled) return;
    await run(async () => {
      await controller.scheduleTaskInCalendar(selectedTask!, taskScheduled);
      dialog = null;
    }, "任务计划日期已更新");
  }

  function openMigration(task?: TaskRecord): void {
    selectedTask = task;
    migrationTasks = task ? [task] : tasksByScope("meeting-draft");
    migrationTarget = snapshot.projects[0]?.path ?? snapshot.clients[0]?.path ?? "";
    migrationBatch = undefined;
    dialog = "migrate";
  }

  function openKnowledge(path: string, status?: string): void {
    selectedKnowledgePath = path;
    knowledgeStatus = status || "待处理";
    knowledgeProject = "";
    knowledgePublishTitle = snapshot.knowledge.find((entry) => entry.path === path)?.name ?? "";
    knowledgePublication = undefined;
    dialog = "knowledge";
  }

  async function undoLayout(): Promise<void> {
    const previous = layoutUndo.at(-1);
    if (!previous) return;
    layoutUndo = layoutUndo.slice(0, -1);
    items = cloneLayoutItems(previous);
    await persistLayoutDraft();
  }

  async function restoreLayout(): Promise<void> {
    const fallback = getDefaultLayouts().find((layout) => layout.id === "workbench" && layout.surface === "workbench");
    if (!fallback) throw new Error("找不到默认工作台布局。");
    layoutUndo = recordLayoutHistory(layoutUndo, items);
    items = normalizeOrderedItems(cloneLayoutItems(fallback.items));
    await persistLayoutDraft();
  }

  async function exportLayout(): Promise<void> {
    await navigator.clipboard.writeText(controller.exportLayout(activeScene));
    message = "布局 JSON 已复制到剪贴板";
  }

  async function submitEntity(): Promise<void> {
    const input: CreateEntityInput = {
      kind: entityKind,
      name: entityName.trim(),
      relatedClient: relatedClient || undefined,
      relatedProject: relatedProject || undefined,
      date: entityDate || undefined,
      startTime: entityKind === "meeting" ? entityStartTime || undefined : undefined,
      endTime: entityKind === "meeting" ? entityEndTime || undefined : undefined,
      openAfterCreate: entityStack.length === 0
    };
    if (!input.name) return;
    busy = true;
    message = "";
    try {
      const receipt = await controller.createEntity(input);
      const parent = entityStack.at(-1);
      if (!parent) {
        message = "条目已创建";
        dialog = null;
        return;
      }
      entityStack = entityStack.slice(0, -1);
      const createdPath = receipt.affectedPaths[0] ?? "";
      const childKind = entityKind;
      entityKind = parent.kind;
      entityName = parent.name;
      relatedClient = childKind === "client" ? createdPath : parent.relatedClient;
      relatedProject = childKind === "project" ? createdPath : parent.relatedProject;
      entityDate = parent.date;
      entityStartTime = parent.startTime;
      entityEndTime = parent.endTime;
      entityTemplatePreview = "";
      message = `${childKind === "client" ? "客户" : "项目"}已创建，已返回原表单`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function submitNote(): Promise<void> {
    const input: CreateNoteInput = {
      title: noteTitle.trim(),
      folder: noteFolder.trim() || undefined,
      body: noteBody.trim() || undefined,
      relatedClient: noteClient || undefined,
      relatedProject: noteProject || undefined
    };
    if (!input.title) return;
    const succeeded = await run(() => controller.createNote(input), "笔记已创建并打开");
    if (succeeded) dialog = null;
  }

  async function submitTask(): Promise<void> {
    const input: AddProjectTaskInput = {
      projectPath,
      text: taskText.trim(),
      due: taskDue || undefined,
      priority: taskPriority
    };
    if (!input.projectPath || !input.text) return;
    const succeeded = await run(
      () => controller.addProjectTask(input),
      "项目任务已添加；是否显示取决于当前今日焦点筛选。"
    );
    if (succeeded) {
      dialog = null;
    }
  }

  async function submitTaskWithTasks(): Promise<void> {
    if (!projectPath) return;
    busy = true;
    message = "";
    try {
      const result = await controller.addProjectTaskWithTasks(projectPath);
      if (result === "committed") {
        message = "项目任务已通过 Tasks 添加";
        dialog = null;
      } else if (result === "unavailable") {
        message = "Tasks 增强当前不可用；仍可使用 Asterism 基础表单。";
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function submitTaskEdit(): Promise<void> {
    if (!selectedTask) return;
    const succeeded = await run(() => controller.updateTask(selectedTask!, { due: taskDue || null, priority: taskPriority }), "任务已更新");
    if (succeeded) {
      taskEditReason = "";
      dialog = null;
    }
  }

  async function submitMigration(): Promise<void> {
    if (!migrationTasks.length || !migrationTarget) return;
    const targetName = [...snapshot.projects, ...snapshot.clients].find((entry) => entry.path === migrationTarget)?.name ?? migrationTarget;
    busy = true;
    message = "";
    try {
      migrationBatch = await controller.migrateMeetingTasks(migrationTasks, migrationTarget);
      message = migrationBatch.status === "completed"
        ? `已迁移到「${targetName}」：${migrationBatch.migratedCount} 条，重复跳过 ${migrationBatch.alreadyMigratedCount} 条`
        : `批次${migrationBatch.status === "partial" ? "部分完成" : "失败"}；请查看逐条回执并继续恢复。`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function retryMigration(): Promise<void> {
    if (!migrationBatch?.retryItems.length) return;
    busy = true;
    try {
      migrationBatch = await controller.retryMeetingMigration(migrationBatch);
      message = migrationBatch.status === "completed" ? "失败项已全部恢复。" : "仍有未完成项，请根据回执检查源文件。";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function submitKnowledge(): Promise<void> {
    if (!selectedKnowledgePath) return;
    const succeeded = await run(() => controller.updateKnowledge(selectedKnowledgePath, knowledgeStatus, knowledgeProject || undefined), "知识状态已更新");
    if (succeeded) dialog = null;
  }

  async function previewKnowledgePublication(): Promise<void> {
    if (!selectedKnowledgePath || !knowledgePublishTitle.trim()) return;
    busy = true;
    try {
      knowledgePublication = await controller.previewKnowledgePublication({
        sourcePath: selectedKnowledgePath,
        title: knowledgePublishTitle.trim(),
        targetFolder: controller.settings.formalKnowledgeFolder,
        templatePath: controller.settings.knowledgeTemplate || undefined,
        projectPath: knowledgeProject || undefined,
        sourceStatus: "已归档"
      });
      message = "已生成只读发布预览；尚未写入任何文件。";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function publishKnowledge(): Promise<void> {
    if (!knowledgePublication) return;
    const succeeded = await run(() => controller.publishKnowledge(knowledgePublication!), "正式知识笔记已创建，来源已标记归档；模板未被修改。");
    if (succeeded) dialog = null;
  }

  function tasksByScope(scope: TaskRecord["scope"]): TaskRecord[] {
    return snapshot.tasks.filter((task) => task.scope === scope && !task.completed && !task.migrated).slice(0, 8);
  }

  function tasksForWidget(widgetId: string, scope: TaskRecord["scope"]): TaskRecord[] {
    const rows = snapshot.tasks.filter((task) => task.scope === scope && !task.completed);
    if (widgetId === "tasks.today") {
      const today = formatDate(new Date(), "YYYY-MM-DD");
      return rows.filter((task) => task.due && task.due <= today).slice(0, 8);
    }
    return rows.slice(0, 8);
  }

  function calendarTasks(): TaskRecord[] {
    const today = new Date();
    const from = formatDate(today, "YYYY-MM-DD");
    const untilDate = new Date(today);
    untilDate.setDate(today.getDate() + 7);
    const until = formatDate(untilDate, "YYYY-MM-DD");
    return snapshot.tasks.filter((task) => !task.completed && task.due && task.due >= from && task.due <= until).slice(0, 8);
  }

  function knowledgeForWidget(widgetId: string) {
    const rows = [...snapshot.knowledge].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    if (widgetId === "knowledge.inbox") return rows.filter((entry) => !entry.status || entry.status === "待处理");
    if (widgetId === "knowledge.triage") return rows.filter((entry) => entry.status === "待沉淀" || entry.status === "待读");
    if (widgetId === "knowledge.project-links") return rows.filter((entry) => entry.related);
    return rows;
  }

  onMount(() => {
    hydrateFocusFilters();
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeydown);
    if (isDesktop && gridEl) {
      gridResizeObserver = new ResizeObserver(updateGridMetrics);
      gridResizeObserver.observe(gridEl);
      updateGridMetrics();
    }
    unsubscribe = controller.subscribe((next) => (snapshot = next));
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeydown);
      gridResizeObserver?.disconnect();
    };
  });

  onDestroy(() => unsubscribe());
</script>

<div class:layout-editing={layoutEditMode} class="qwb-shell" data-scene={activeScene}>
  <header class="qwb-hero">
    <div class="qwb-hero-topline"><span>ASTERISM · 星序 · {UI_VERSION}</span><div class="qwb-hero-topline-meta"><span use:obsidianIcon={heroStatusIcon()} class:enabled={heroStatus.tone === "enabled"} class:error={heroStatus.tone === "error"} class="qwb-hero-inline-status" role="status" aria-label={heroStatus.label} title={heroStatus.label}></span><time>{heroDate()}</time></div></div>
    <div class="qwb-hero-symbol" aria-hidden="true"><span use:obsidianIcon={"asterism-mark"}></span><i use:obsidianIcon={"sparkles"}></i></div>
    <div class="qwb-hero-main">
      {#key `${heroCopy.title}|${heroCopy.subtitle}`}
        <div class="qwb-hero-copy">
          <span>每日总览</span>
          <h1>{heroCopy.title}</h1>
          <p>{heroCopy.subtitle}</p>
        </div>
      {/key}
      <div class="qwb-header-actions qwb-page-nav" role="toolbar" aria-label="Asterism 页面导航与操作">
        <button use:obsidianIcon={"asterism-mark"} class="qwb-hero-action is-current" aria-label="当前页面：工作台" title="工作台" aria-current="page" on:click={() => controller.openWorkbench()}></button>
        <button use:obsidianIcon={"list-todo"} class="qwb-hero-action" aria-label="打开任务看板" title="任务看板" on:click={() => controller.openTaskBoard()}></button>
        <button use:obsidianIcon={"clipboard-check"} class="qwb-hero-action" aria-label="打开项目审阅" title="项目审阅" on:click={() => controller.openProjectReview()}></button>
        <button use:obsidianIcon={"calendar-days"} class="qwb-hero-action" aria-label="打开完整日程" title="完整日程" on:click={() => run(() => controller.openCalendar())}></button>
        <button use:obsidianIcon={"panel-right-open"} class="qwb-hero-action" aria-label="打开上下文侧栏" title="上下文侧栏" on:click={() => controller.openContextPanel()}></button>
        <span class="qwb-page-nav-divider" aria-hidden="true"></span>
        <button use:obsidianIcon={"refresh-cw"} class="qwb-hero-action" aria-label="刷新工作台" title="刷新" disabled={busy} on:click={() => run(() => controller.refresh(), "已刷新")}></button>
        <button use:obsidianIcon={layoutEditMode ? "check" : "layout-dashboard"} class:active={layoutEditMode} class="qwb-hero-action" aria-label={layoutEditMode ? "保存并完成布局编辑" : "编辑布局"} title={layoutEditMode ? "保存布局" : "编辑布局"} aria-pressed={layoutEditMode} on:click={() => layoutEditMode ? run(saveLayoutEditing, "布局已保存") : beginLayoutEditing()}></button>
        <button use:obsidianIcon={"rotate-ccw"} class="qwb-hero-action" aria-label="撤销最近一次业务写入" title="撤销业务写入" disabled={busy} on:click={() => run(() => controller.undoLastTransaction(), "已撤销最近一次操作")}></button>
      </div>
    </div>
    <div class="qwb-hero-search-region" role="search" aria-label="全库搜索">
      <button class="qwb-hero-search" type="button" aria-label="使用 Omnisearch 搜索笔记、项目、客户与会议" on:click={() => run(() => controller.openGlobalSearch(), "已打开全库搜索")}>
        <i use:obsidianIcon={"search"} aria-hidden="true"></i>
        <span>搜索笔记、项目、客户与会议……</span>
        <kbd>Omnisearch</kbd>
      </button>
    </div>
    <div class="qwb-hero-metrics">
      {#each heroMetrics as metric}
        <div class:danger={metric.tone === "danger"} class:accent={metric.tone === "accent"} class="qwb-hero-metric"><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></div>
      {/each}
    </div>
  </header>

  {#if layoutEditMode}
    <LayoutEditorBar
      dirty={layoutDirty}
      canUndo={layoutUndo.length > 0}
      {busy}
      onAdd={() => { selectedWidgetType = ""; showWidgetLibrary = true; }}
      onUndo={() => run(undoLayout, "已撤销布局调整")}
      onRestore={() => run(restoreLayout, "已载入默认布局；保存后生效")}
      onExport={() => run(exportLayout, "布局已导出")}
      onCancel={cancelLayoutEditing}
      onSave={() => run(saveLayoutEditing, "布局已保存")}
    />
  {/if}

  {#if !controller.settings.writesEnabled}
    <div class="qwb-safety-banner">
      <div><strong>当前为只读模式</strong><span>可以浏览和运行诊断；在设置中确认后才会开放写入。</span></div>
      <button on:click={() => controller.refresh()}>重新诊断</button>
    </div>
  {/if}

  {#if message}
    <div class="qwb-toast" role="status">{message}</div>
  {/if}

  {#key activeScene}
    <div class="qwb-grid" bind:this={gridEl}>
    {#each items.filter((item) => !item.hidden && enabled(item)) as item, itemIndex (itemKey(item))}
      <section data-instance-id={itemKey(item)} class:collapsed={item.collapsed} class:editing={layoutEditMode} class="qwb-widget" style={itemStyle(item)}>
        <header class="qwb-widget-header">
          {#if layoutEditMode}
            <span class="qwb-layout-order" aria-label={`布局顺序 ${itemIndex + 1}`}>{itemIndex + 1}</span>
          {/if}
          <h2>{widgetTitle(item)}</h2>
          {#if layoutEditMode}
            <div class="qwb-widget-controls">
              <button use:obsidianIcon={"arrow-left"} aria-label={`将${widgetTitle(item)}前移`} title="前移" disabled={itemIndex === 0} on:click={() => moveItem(itemKey(item), -1)}></button>
              <button use:obsidianIcon={"arrow-right"} aria-label={`将${widgetTitle(item)}后移`} title="后移" disabled={itemIndex === items.filter((candidate) => !candidate.hidden && enabled(candidate)).length - 1} on:click={() => moveItem(itemKey(item), 1)}></button>
              <button use:obsidianIcon={"settings-2"} aria-label="组件设置" title="组件设置" on:click={() => openWidgetSettings(item)}></button>
              <button use:obsidianIcon={item.collapsed ? "chevron-down" : "chevron-up"} aria-label={item.collapsed ? "展开" : "折叠"} title={item.collapsed ? "展开" : "折叠"} on:click={() => setItemState(itemKey(item), { collapsed: !item.collapsed })}></button>
              <button use:obsidianIcon={"eye-off"} aria-label="隐藏" title="隐藏组件" on:click={() => setItemState(itemKey(item), { hidden: true })}></button>
            </div>
          {/if}
        </header>

        {#if !item.collapsed}
          <div class="qwb-widget-body">
            {#if item.widgetId === "core.quick-create"}
              <div class="qwb-create-grid">
                <button on:click={openNote}><span>＋</span>笔记</button>
                <button on:click={() => openCreate("project")}><span>＋</span>项目</button>
                <button on:click={() => openCreate("client")}><span>＋</span>客户</button>
                <button on:click={() => openCreate("meeting")}><span>＋</span>会议</button>
                <button on:click={() => openCreate("supplier")}><span>＋</span>供应商</button>
              </div>
              <button class="qwb-button qwb-button-primary qwb-full" on:click={() => openTask()}>添加项目任务</button>
            {:else if item.widgetId === "tasks.today" || item.presetId === "tasks.today-focus"}
              <div class="qwb-focus-toolbar">
                <div class="qwb-focus-quick" aria-label="今日焦点快捷筛选">
                  {#each [["all", "全部"], ["overdue", "逾期"], ["today", "今天"], ["high", "高优先"]] as option}
                    <button type="button" class:active={focusFiltersForItem(item).quick === option[0]} on:click={() => setQuickFilter(item, option[0] as FocusQuickFilter)}>{option[1]}</button>
                  {/each}
                  <button type="button" class="qwb-filter-toggle" class:active={focusFiltersVisible(item)} aria-expanded={focusFiltersVisible(item)} on:click={() => toggleFocusFilters(item)}>{focusFiltersVisible(item) ? "完成" : "筛选"}<span>{visibleFocusTasks(item).length} 条</span></button>
                </div>
                <button class="qwb-yolo-button" title="分析当前筛选下的全部任务" on:click={() => run(() => openFocusYolo(item), "YOLO 已打开；当前列表已复制，请粘贴到输入框。")}>YOLO 处理本页</button>
              </div>

              {#if focusFiltersVisible(item)}
                <div class="qwb-focus-filters">
                  <div class="qwb-focus-filter-heading"><strong>组合筛选</strong><span>{activeFocusFilterCount(focusFiltersForItem(item)) ? `已选 ${activeFocusFilterCount(focusFiltersForItem(item))} 项` : "可多选"}</span><button type="button" on:click={() => run(() => clearFocusFilters(item), "筛选已重置")}>重置</button><button type="button" class="qwb-filter-done" on:click={closeFocusFilters}>完成</button></div>
                  <div class="qwb-filter-group"><strong>任务来源</strong><div>{#each [["project", "项目任务"], ["client", "客户行动"], ["meeting-draft", "会议草稿"]] as option}<button type="button" class:active={focusFiltersForItem(item).scopes.includes(option[0] as TaskRecord["scope"])} on:click={() => toggleFocusValue(item, "scopes", option[0] as TaskRecord["scope"])}>{option[1]}</button>{/each}</div></div>
                  <div class="qwb-filter-group"><strong>项目类型</strong><div>{#each focusProjectTypes() as projectType}<button type="button" class:active={focusFiltersForItem(item).projectTypes.includes(projectType)} on:click={() => toggleFocusValue(item, "projectTypes", projectType)}>{projectType}</button>{/each}</div></div>
                  <div class="qwb-filter-group"><strong>优先级</strong><div>{#each [["highest", "最高"], ["high", "高"], ["normal", "普通"], ["low", "低"]] as option}<button type="button" class:active={focusFiltersForItem(item).priorities.includes(option[0] as NonNullable<TaskRecord["priority"]>)} on:click={() => toggleFocusValue(item, "priorities", option[0] as NonNullable<TaskRecord["priority"]>)}>{option[1]}</button>{/each}</div></div>
                  <div class="qwb-filter-group"><strong>状态</strong><div>{#each [["open", "未完成"], ["completed", "已完成"]] as option}<button type="button" class:active={focusFiltersForItem(item).statuses.includes(option[0] as FocusTaskStatus)} on:click={() => toggleFocusValue(item, "statuses", option[0] as FocusTaskStatus)}>{option[1]}</button>{/each}</div></div>
                  <div class="qwb-filter-group qwb-client-filter"><strong>客户</strong><button type="button" class="qwb-client-trigger" on:click={() => openClientPicker(item)}>{focusFiltersForItem(item).clients.length ? `已选 ${focusFiltersForItem(item).clients.length}` : "选择客户"}</button></div>
                </div>
              {/if}

              <div class="qwb-focus-list">
                {#each visibleFocusTasks(item) as task (task.id)}
                  <div class:completed={task.completed} class="qwb-focus-row">
                    <input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || busy || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} />
                    <div class="qwb-focus-content">
                      <button class="qwb-focus-title" title={task.text} on:click={() => controller.openPath(task.path)}>{task.text}</button>
                      <div class="qwb-focus-meta">
                        <span class="qwb-focus-source"><b>{scopeLabel(task.scope)}</b><em>{task.sourceName}</em></span>
                        <time>{focusDate(task)}</time>
                        {#if task.priority && task.priority !== "normal"}<span class:high={task.priority === "highest" || task.priority === "high"} class="qwb-focus-priority">{priorityLabel(task.priority)}优先</span>{/if}
                      </div>
                    </div>
                    {#if task.scope === "meeting-draft"}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button>{:else}<div class="qwb-row-actions"><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openTaskSchedule(task)}>安排</button><button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button></div>{/if}
                  </div>
                {:else}
                  <div class="qwb-focus-empty"><p class="qwb-empty">当前筛选下没有任务。</p><button type="button" on:click={() => run(() => clearFocusFilters(item), "筛选已重置")}>清除筛选</button></div>
                {/each}
              </div>
              <button class="qwb-text-action" on:click={() => openTask()}>＋ 添加项目任务</button>

              {#if showClientPicker}
                <div class="qwb-client-picker-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (showClientPicker = false)}>
                  <div class="qwb-client-picker" role="dialog" aria-modal="true" aria-label="选择客户">
                    <header><strong>选择客户</strong><button on:click={() => (showClientPicker = false)}>关闭</button></header>
                    <input class="qwb-client-search" bind:value={clientSearch} placeholder="搜索客户名称" on:input={() => (clientCursor = 0)} on:keydown={handleClientSearchKey} />
                    <small>支持名称、路径和别名搜索；↑↓ 选择，Enter 勾选。</small>
                    <div class="qwb-client-results">
                      {#each clientSearchResults() as client (client.path)}
                        <label class:cursor={clientSearchResults()[clientCursor]?.path === client.path} on:focusin={() => (clientCursor = clientSearchResults().findIndex((entry) => entry.path === client.path))}><input type="checkbox" checked={draftClients.includes(client.path)} on:change={() => toggleDraftClient(client.path)} /><span><strong>{client.name}</strong><small>{client.aliases?.join("、") || client.path}</small></span></label>
                      {:else}<p class="qwb-empty">没有匹配的客户。</p>{/each}
                    </div>
                    <div class="qwb-client-selected">{#each draftClients.slice(0, 6) as path}<span>{snapshot.clients.find((client) => client.path === path)?.name ?? path}</span>{/each}{#if draftClients.length > 6}<span>还有 {draftClients.length - 6} 个</span>{/if}</div>
                    <footer><button on:click={() => (draftClients = [])}>清空</button><button class="qwb-button-primary" on:click={applyClientPicker}>确认（{draftClients.length}）</button></footer>
                  </div>
                </div>
              {/if}
            {:else if item.widgetId === "tasks.list" || item.widgetId === "projects.tasks-list" || (item.widgetId === "view.list" && dataSource(item) === "tasks" && !["project-matrix", "client-groups"].includes(displayVariant(item)))}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索任务" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedTasks(item).length}</span></div>
              <div class="qwb-task-list">
                {#each taskRowsForWidget(item) as task (task.id)}
                  <div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || busy || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" title={task.text} on:click={() => controller.openPath(task.path)}><span class="qwb-task-title-text">{task.text}</span></button><div class="qwb-task-meta"><span class="qwb-task-source" title={`${scopeLabel(task.scope)} · ${task.sourceName}`}><b>{scopeLabel(task.scope)}</b><em>{task.sourceName}</em></span><time>{effectiveTaskDate(task) ?? "未安排"}</time>{#if task.priority && task.priority !== "normal"}<span class:high={task.priority === "highest" || task.priority === "high"} class="qwb-task-priority">{priorityLabel(task.priority)}</span>{/if}</div>{#if task.scope === "meeting-draft"}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button>{:else}<div class="qwb-row-actions"><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openTaskSchedule(task)}>安排</button><button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button></div>{/if}</div>
                {:else}<p class="qwb-empty">当前组件范围内没有任务。</p>{/each}
              </div>
              {#if queryMode(item) !== "client-actions"}<button class="qwb-text-action" on:click={() => openTask(scopedProjectPath(item))}>＋ 添加项目任务</button>{/if}
            {:else if item.widgetId === "tasks.board" || item.widgetId === "projects.tasks-board" || (item.widgetId === "view.board" && dataSource(item) === "tasks")}
              <div class="qwb-board">
                {#each [["overdue", "逾期"], ["today", "今天"], ["week", "本周"], ["later", "以后"], ["unscheduled", "未安排"]] as column}
                  <section role="group" aria-label={`${column[1]}任务列`}>
                    <header><strong>{column[1]}</strong><span>{tasksInBucket(item, column[0] as TaskTimeBucket).length}</span></header>
                    <div class="qwb-board-column-body">
                      {#each tasksInBucket(item, column[0] as TaskTimeBucket) as task (task.id)}
                        <article class="qwb-board-card">
                          <button class="qwb-board-card-main" on:click={() => controller.openPath(task.path)}>
                            <strong>{task.text}</strong>
                            <small>{task.sourceName}</small>
                            {#if effectiveTaskDate(task)}<time>{effectiveTaskDate(task)}</time>{/if}
                          </button>
                        </article>
                      {:else}<p>暂无</p>{/each}
                    </div>
                  </section>
                {/each}
              </div>
            {:else if item.widgetId === "tasks.calendar" || item.widgetId === "view.calendar"}
              {#if isScheduleOverview(item)}
                <div class="qwb-schedule-overview">
                  <header class="qwb-schedule-overview-header">
                    <span><strong>未来 7 天</strong><small>计划任务、会议与外部日程</small></span>
                    <button use:obsidianIcon={snapshot.calendar.state === "ready" ? "calendar-clock" : "plug-zap"} class:active={snapshot.calendar.state === "ready"} disabled={snapshot.calendar.state === "unavailable"} aria-label={calendarIntegrationTitle()} title={calendarIntegrationTitle()} on:click={() => run(useCalendarIntegration, "日程已打开")}></button>
                  </header>
                  <div class="qwb-schedule-agenda">
                    {#each scheduleAgendaGroups(item) as group (group.date)}
                      <section>
                        <header><time>{calendarDateLabel(group.date)}</time><span>{group.entries.length} 项</span></header>
                        <div>
                          {#each group.entries as entry (entry.id)}
                            <button class:completed={entry.completed} on:click={() => openCalendarEntry(entry)}>
                              <time>{entry.time || "全天"}</time>
                              <i class={calendarDotClass(entry)}></i>
                              <span><strong>{entry.title}</strong><small>{entry.subtitle}</small></span>
                              <em>{entry.kind === "meeting" ? "会议" : entry.kind === "event" ? "日程" : "计划"}</em>
                            </button>
                          {/each}
                        </div>
                      </section>
                    {:else}
                      <div class="qwb-schedule-empty"><i use:obsidianIcon={"calendar-check"}></i><strong>未来 7 天没有已安排日程</strong><small>只有截止日期的任务会留在“任务日历”。</small></div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div class="qwb-month-calendar">
                  <header class="qwb-month-calendar-toolbar">
                    <button use:obsidianIcon={"chevron-left"} aria-label="上个月" title="上个月" on:click={() => moveCalendarMonth(item, -1)}></button>
                    <strong>{calendarMonthLabel(calendarState(item, calendarViewStates[itemKey(item)]).month)}</strong>
                    <button class="qwb-calendar-today" on:click={() => resetCalendarToday(item)}>今天</button>
                    <button use:obsidianIcon={"chevron-right"} aria-label="下个月" title="下个月" on:click={() => moveCalendarMonth(item, 1)}></button>
                  </header>
                  <div class="qwb-month-calendar-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as weekday}<span>{weekday}</span>{/each}</div>
                  <div class="qwb-month-calendar-grid">
                    {#each calendarCells(item, calendarViewStates[itemKey(item)]) as cell (cell.date)}
                      <button class:outside={!cell.inMonth} class:today={cell.isToday} class:selected={calendarState(item, calendarViewStates[itemKey(item)]).selected === cell.date} aria-label={`${cell.date}，${calendarEntriesForDate(item, cell.date).length} 项`} title={`${cell.date} · ${calendarEntriesForDate(item, cell.date).length} 项`} on:click={() => setCalendarDate(item, cell.date)}>
                        <time>{cell.day}</time>
                        <span class="qwb-calendar-dots">
                          {#each calendarEntriesForDate(item, cell.date).slice(0, 3) as entry (entry.id)}<i class={calendarDotClass(entry)}></i>{/each}
                          {#if calendarEntriesForDate(item, cell.date).length > 3}<small>{calendarEntriesForDate(item, cell.date).length}</small>{/if}
                        </span>
                      </button>
                    {/each}
                  </div>
                  <section class="qwb-calendar-detail">
                    <header><strong>{calendarDateLabel(calendarState(item, calendarViewStates[itemKey(item)]).selected)}</strong><span>{calendarEntriesForDate(item, calendarState(item, calendarViewStates[itemKey(item)]).selected).length} 项</span></header>
                    <div>
                      {#each calendarEntriesForDate(item, calendarState(item, calendarViewStates[itemKey(item)]).selected) as entry (entry.id)}
                        <button class:overdue={entry.overdue} class:completed={entry.completed} on:click={() => openCalendarEntry(entry)}><i class={calendarDotClass(entry)}></i><span><strong>{entry.title}</strong><small>{entry.subtitle}</small></span><em>{entry.kind === "meeting" ? "会议" : entry.completed ? "已完成" : "截止"}</em></button>
                      {:else}<p class="qwb-empty">这一天没有{dataSource(item) === "meetings" ? "会议" : "截止任务"}。</p>{/each}
                    </div>
                  </section>
                </div>
              {/if}
            {:else if item.widgetId === "tasks.quadrant" || (item.widgetId === "view.quadrant" && dataSource(item) === "tasks")}
              <div class="qwb-quadrants">
                {#each [["important-urgent", "重要且紧急"], ["important", "重要不紧急"], ["urgent", "紧急不重要"], ["later", "不重要不紧急"]] as quadrant}
                  <section class={`qwb-quadrant-${quadrant[0]}`}><header><strong>{quadrant[1]}</strong><span>{tasksInQuadrant(item, quadrant[0] as TaskQuadrant).length}</span></header>{#each tasksInQuadrant(item, quadrant[0] as TaskQuadrant) as task (task.id)}<button on:click={() => controller.openPath(task.path)}>{task.text}<small>{effectiveTaskDate(task) ?? task.sourceName}</small></button>{:else}<p>暂无</p>{/each}</section>
                {/each}
              </div>
            {:else if item.widgetId === "tasks.project-matrix" || (item.widgetId === "view.list" && displayVariant(item) === "project-matrix")}
              <div class="qwb-matrix">
                {#each projectTaskGroups(item) as group}
                  <section><button class="qwb-matrix-heading" on:click={() => controller.openPath(group[0].path)}><strong>{group[0].name}</strong><span>{group[1].length}</span></button>{#each group[1].slice(0, 6) as task (task.id)}<button on:click={() => controller.openPath(task.path)}>{task.text}<time>{effectiveTaskDate(task) ?? ""}</time></button>{/each}</section>
                {:else}<p class="qwb-empty">没有开放项目任务。</p>{/each}
              </div>
            {:else if item.widgetId === "tasks.client-actions" || (item.widgetId === "view.list" && displayVariant(item) === "client-groups")}
              <div class="qwb-matrix">
                {#each clientTaskGroups(item) as group}
                  <section><button class="qwb-matrix-heading" on:click={() => controller.openPath(group[0].path)}><strong>{group[0].name}</strong><span>{group[1].length}</span></button>{#each group[1].slice(0, 6) as task (task.id)}<button on:click={() => controller.openPath(task.path)}>{task.text}<time>{effectiveTaskDate(task) ?? ""}</time></button>{/each}</section>
                {:else}<p class="qwb-empty">没有关联客户的行动。</p>{/each}
              </div>
            {:else if item.widgetId === "tasks.workload" || (item.widgetId === "view.metrics" && metricKind(item) === "workload")}
              <div class="qwb-workload">
                {#each workloadDays(item) as day}<div><time>{day.date.slice(5)}</time><span><i style={`width:${day.width}%`}></i></span><strong>{day.count}</strong></div>{/each}
              </div>
            {:else if item.widgetId === "view.heatmap"}
              <div class="qwb-activity-layout">
                <div class="qwb-activity-summary">
                  <span><strong>{activitySummary().total}</strong><small>一年内更新</small></span>
                  <span><strong>{activitySummary().activeDays}</strong><small>活跃天数</small></span>
                  <span><strong>{activitySummary().currentStreak}</strong><small>当前连续</small></span>
                  <span><strong>{activitySummary().longestStreak}</strong><small>最长连续</small></span>
                </div>
                <div class="qwb-activity-map">
                  <div class="qwb-activity-scroll" aria-label="最近一年笔记活动热力图">
                    <div class="qwb-activity-weekdays" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
                    <div class="qwb-activity-grid">
                      {#each activityCalendar() as cell (cell.date)}
                        <span class={`level-${cell.level}`} class:out-of-range={!cell.inRange} title={`${cell.date} · ${cell.count} 次更新`} aria-label={`${cell.date}，${cell.count} 次更新`}></span>
                      {/each}
                    </div>
                  </div>
                  <div class="qwb-activity-legend"><small>少</small>{#each [0, 1, 2, 3, 4] as level}<i class={`level-${level}`}></i>{/each}<small>多</small></div>
                </div>
              </div>
            {:else if item.widgetId === "tasks.timeline" || (item.widgetId === "view.timeline" && dataSource(item) === "tasks")}
              <div class="qwb-timeline">
                {#each groupTasksByDate(item).filter(([date]) => date !== "未安排") as group}<section><time>{group[0]}</time><div>{#each group[1] as task (task.id)}<button on:click={() => controller.openPath(task.path)}>{task.text}<small>{task.sourceName}</small></button>{/each}</div></section>{:else}<p class="qwb-empty">暂无带日期的任务。</p>{/each}
              </div>
            {:else if ["tasks.inbox", "tasks.waiting", "tasks.week", "tasks.recurring", "projects.waiting"].includes(item.widgetId)}
              <div class="qwb-task-list">
                {#each taskRowsForWidget(item) as task (task.id)}<div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" title={task.text} on:click={() => controller.openPath(task.path)}><span class="qwb-task-title-text">{task.text}</span></button><div class="qwb-task-meta"><span class="qwb-task-source" title={task.sourceName}><em>{task.sourceName}</em></span>{#if effectiveTaskDate(task)}<time>{effectiveTaskDate(task)}</time>{/if}{#if task.priority && task.priority !== "normal"}<span class:high={task.priority === "highest" || task.priority === "high"} class="qwb-task-priority">{priorityLabel(task.priority)}</span>{/if}</div>{#if task.scope === "meeting-draft"}<button class="qwb-row-action" on:click={() => openMigration(task)}>迁移</button>{/if}</div>{:else}<p class="qwb-empty">当前没有符合条件的任务。</p>{/each}
              </div>
            {:else if item.widgetId.startsWith("tasks.")}
              <div class="qwb-task-list">{#each scopedTasks(item) as task (task.id)}<div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" title={task.text} on:click={() => controller.openPath(task.path)}><span class="qwb-task-title-text">{task.text}</span></button><div class="qwb-task-meta"><span class="qwb-task-source" title={task.sourceName}><em>{task.sourceName}</em></span>{#if effectiveTaskDate(task)}<time>{effectiveTaskDate(task)}</time>{/if}{#if task.priority && task.priority !== "normal"}<span class:high={task.priority === "highest" || task.priority === "high"} class="qwb-task-priority">{priorityLabel(task.priority)}</span>{/if}</div><button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button></div>{:else}<p class="qwb-empty">暂无任务。</p>{/each}</div>
              <button class="qwb-text-action" on:click={() => openTask(scopedProjectPath(item))}>＋ 添加项目任务</button>
            {:else if item.widgetId === "capture.memo"}
              <div class="qwb-memo-compose">
                <textarea bind:this={memoInput} bind:value={memoDraft} rows="3" placeholder="记下一条；时间会自动添加。" on:keydown={handleMemoKeydown}></textarea>
                <div><small>Enter 记录 · Shift + Enter 换行</small><button disabled={!controller.settings.writesEnabled || !memoDraft.trim() || busy} on:click={submitQuickMemo}>记录一条</button><button disabled={!snapshot.memo.exists} title={snapshot.memo.path || "尚未创建速记文件"} on:click={() => run(() => controller.openPath(snapshot.memo.path), "已打开速记文件")}>打开文件</button><button disabled={!snapshot.memo.exists} on:click={() => run(openMemoYolo, "已打开 YOLO；整理说明已复制，请粘贴到输入框。")}>YOLO 整理今日</button></div>
              </div>
              {#if snapshot.memo.error}<p class="qwb-inline-error">{snapshot.memo.error}</p>{/if}
              <div class="qwb-memo-recent">
                {#each snapshot.memo.recent as entry}<button on:click={() => controller.openPath(snapshot.memo.path)}><time>{entry.time || "—"}</time><span>{entry.text}</span><small>{entry.date === formatDate(new Date(), "YYYY-MM-DD") ? "今天" : entry.date}</small></button>{:else}<p class="qwb-empty">尚无速记。首次记录会创建配置的速记文件。</p>{/each}
              </div>
            {:else if item.widgetId === "core.calendar"}
              <div class="qwb-calendar-date"><strong>{new Date().getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", weekday: "long" }).format(new Date())}</span></div>
              <div class="qwb-calendar-lines">
                {#each calendarTasks() as task}
                  <button on:click={() => controller.openPath(task.path)}><time>{task.due}</time><span>{task.text}</span></button>
                {:else}
                  <p class="qwb-empty">今天没有已标记日期的任务。</p>
                {/each}
              </div>
            {:else if item.widgetId === "projects.search" || item.widgetId === "control.selector"}
              {#if dataSource(item) === "clients"}
                {#if sharedClient()}<div class="qwb-shared-project"><span><small>当前共享客户</small><strong>{sharedClient()!.name}</strong></span><button on:click={() => controller.openPath(sharedClient()!.path)}>打开</button><button on:click={() => (sharedClientPath = "")}>清除</button></div>{/if}
                <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索客户名称、别名或业务领域" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedClients(item).length}</span></div>
                <div class="qwb-project-search-results">{#each scopedClients(item).slice(0, 8) as client}<div class:active={sharedClientPath === client.path}><button class="qwb-project-choice" on:click={() => (sharedClientPath = client.path)}><strong>{client.name}</strong><span><small>{client.organizationType || "未分类"}</small><small>{client.relationshipStatus || "未设置关系"}</small><small>{client.followupDate || "未安排跟进"}</small></span></button><div class="qwb-project-choice-actions"><button class:active={sharedClientPath === client.path} on:click={() => (sharedClientPath = client.path)}>{sharedClientPath === client.path ? "已选择" : "选择"}</button><button on:click={() => controller.openPath(client.path)}>打开</button></div></div>{:else}<p class="qwb-empty">没有匹配客户。</p>{/each}</div>
              {:else if dataSource(item) === "meetings"}
                <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索会议名称、项目或客户" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedMeetings(item).length}</span></div>
                <div class="qwb-project-search-results">{#each scopedMeetings(item).slice(0, 8) as meeting}<div class:active={sharedMeetingPath === meeting.path}><button class="qwb-project-choice" on:click={() => (sharedMeetingPath = meeting.path)}><strong>{meeting.name}</strong><span><small>{meeting.due || "未设置日期"}</small><small>{meeting.project || meeting.client || "未关联"}</small></span></button><div class="qwb-project-choice-actions"><button class:active={sharedMeetingPath === meeting.path} on:click={() => (sharedMeetingPath = meeting.path)}>{sharedMeetingPath === meeting.path ? "已选择" : "选择"}</button><button on:click={() => controller.openPath(meeting.path)}>打开</button></div></div>{:else}<p class="qwb-empty">没有匹配会议。</p>{/each}</div>
              {:else if dataSource(item) === "suppliers"}
                <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索供应商名称或状态" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedSuppliers(item).length}</span></div>
                <div class="qwb-project-search-results">{#each scopedSuppliers(item).slice(0, 8) as supplier}<div class:active={sharedSupplierPath === supplier.path}><button class="qwb-project-choice" on:click={() => (sharedSupplierPath = supplier.path)}><strong>{supplier.name}</strong><span><small>{supplier.status || "未设置状态"}</small><small>{supplier.detail || supplier.related || "供应商"}</small></span></button><div class="qwb-project-choice-actions"><button class:active={sharedSupplierPath === supplier.path} on:click={() => (sharedSupplierPath = supplier.path)}>{sharedSupplierPath === supplier.path ? "已选择" : "选择"}</button><button on:click={() => controller.openPath(supplier.path)}>打开</button></div></div>{:else}<p class="qwb-empty">没有匹配供应商。</p>{/each}</div>
              {:else}
                {#if sharedProject()}<div class="qwb-shared-project"><span><small>当前共享项目</small><strong>{sharedProject()!.name}</strong></span><button on:click={() => controller.openPath(sharedProject()!.path)}>打开</button><button on:click={() => (sharedProjectPath = "")}>清除</button></div>{/if}
                <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索项目名称、客户或类型" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedProjects(item).length}</span></div>
                <div class="qwb-project-search-results">{#each scopedProjects(item).slice(0, 8) as project}<div class:active={sharedProjectPath === project.path}><button class="qwb-project-choice" on:click={() => (sharedProjectPath = project.path)}><strong>{project.name}</strong><span><small>{projectClientLabel(project)}</small><small>{project.projectType || "未分类"}</small><small>{project.status || project.phase || "开放"}</small></span></button><div class="qwb-project-choice-actions"><button class:active={sharedProjectPath === project.path} on:click={() => (sharedProjectPath = project.path)}>{sharedProjectPath === project.path ? "已选择" : "选择"}</button><button on:click={() => controller.openPath(project.path)}>打开</button></div></div>{:else}<p class="qwb-empty">没有匹配项目。</p>{/each}</div>
              {/if}
            {:else if item.widgetId === "projects.list" || (item.widgetId === "view.list" && dataSource(item) === "projects" && !["risks", "milestones"].includes(queryMode(item)))}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索项目" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedProjects(item).length}</span></div>
              <div class="qwb-project-table">{#each projectRowsForWidget(item) as project}<button on:click={() => controller.openPath(project.path)}><span><strong>{project.name}</strong><small>{project.client || "未关联客户"}</small></span><em>{project.projectType || "未分类"}</em><em>{project.status || project.phase || "开放"}</em><time>{project.due || ""}</time></button>{:else}<p class="qwb-empty">没有匹配项目。</p>{/each}</div>
            {:else if item.widgetId === "view.board" && dataSource(item) === "clients"}
              <div class="qwb-board qwb-client-board">
                {#each clientStatusGroups(item) as group}<section><header><strong>{group[0]}</strong><span>{group[1].length}</span></header><div class="qwb-board-column-body">{#each group[1] as client}<article class="qwb-board-card"><button class="qwb-board-card-main" on:click={() => controller.openPath(client.path)}><strong>{client.name}</strong><small>{client.organizationType || client.businessDomains || "客户"}</small><time>{client.followupDate || "未安排跟进"}</time></button></article>{/each}</div></section>{:else}<p class="qwb-empty">暂无客户关系数据。</p>{/each}
              </div>
            {:else if item.widgetId === "view.board" && dataSource(item) === "suppliers"}
              <div class="qwb-board qwb-project-board">
                {#each [...new Map(scopedSuppliers(item).map((supplier) => [supplier.status || "未设置", scopedSuppliers(item).filter((entry) => (entry.status || "未设置") === (supplier.status || "未设置"))])).entries()] as group}<section><header><strong>{group[0]}</strong><span>{group[1].length}</span></header><div class="qwb-board-column-body">{#each group[1] as supplier}<article class="qwb-board-card"><button class="qwb-board-card-main" on:click={() => controller.openPath(supplier.path)}><strong>{supplier.name}</strong><small>{supplier.detail || supplier.related || "供应商"}</small></button></article>{/each}</div></section>{:else}<p class="qwb-empty">暂无供应商。</p>{/each}
              </div>
            {:else if item.widgetId === "projects.board" || (item.widgetId === "view.board" && dataSource(item) === "projects")}
              <div class="qwb-board qwb-project-board">
                {#each projectStatusGroups(item) as group}
                  <section>
                    <header><strong>{group[0]}</strong><span>{group[1].length}</span></header>
                    <div class="qwb-board-column-body">
                      {#each group[1] as project}
                        <article class="qwb-board-card">
                          <button class="qwb-board-card-main" on:click={() => controller.openPath(project.path)}>
                            <strong>{project.name}</strong>
                            <small>{project.client || project.projectType || "开放项目"}</small>
                            {#if project.due}<time>{project.due}</time>{/if}
                          </button>
                        </article>
                      {/each}
                    </div>
                  </section>
                {:else}<p class="qwb-empty">暂无项目。</p>{/each}
              </div>
            {:else if item.widgetId === "projects.summary" || item.widgetId === "view.detail"}
              {#if dataSource(item) === "clients"}
                {#each selectedClient(item) ? [selectedClient(item)!] : [] as client}<div class="qwb-project-summary qwb-client-summary"><button class="qwb-summary-title" on:click={() => controller.openPath(client.path)}><span class="qwb-entity-icon client">C</span><span><strong>{client.name}</strong><small>{client.businessDomains || "未填写业务领域"}</small></span><em>{client.relationshipStatus || "未设置"}</em></button><dl><div><dt>机构类型</dt><dd>{client.organizationType || "未设置"}</dd></div><div><dt>关系状态</dt><dd>{client.relationshipStatus || "未设置"}</dd></div><div><dt>跟进日期</dt><dd>{client.followupDate || "未安排"}</dd></div><div><dt>开放项目</dt><dd>{projectsForClient(client.path).length}</dd></div><div><dt>未完成行动</dt><dd>{tasksForClient(client.path).length}</dd></div><div><dt>相关会议</dt><dd>{meetingsForClient(client.path).length}</dd></div></dl><div class="qwb-project-next"><small>客户摘要</small><p>{client.detail || "尚未填写客户摘要。"}</p></div><div class="qwb-summary-actions"><button disabled={sharedClientPath === client.path} on:click={() => (sharedClientPath = client.path)}>{sharedClientPath === client.path ? "当前共享客户" : "设为共享客户"}</button><button on:click={() => controller.openPath(client.path)}>打开客户</button><button on:click={() => controller.openYolo(client.path)}>YOLO</button></div></div>{:else}<p class="qwb-empty">请先用客户选择器选择客户。</p>{/each}
              {:else if dataSource(item) === "meetings"}
                {#each selectedMeeting(item) ? [selectedMeeting(item)!] : [] as meeting}<div class="qwb-project-summary"><button class="qwb-summary-title" on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.project || meeting.client || "未关联"}</small></span><em>{meeting.due || "未设置日期"}</em></button><dl><div><dt>状态</dt><dd>{meeting.status || "未设置"}</dd></div><div><dt>项目</dt><dd>{meeting.project || "未关联"}</dd></div><div><dt>客户</dt><dd>{meeting.client || "未关联"}</dd></div><div><dt>行动项</dt><dd>{snapshot.tasks.filter((task) => task.path === meeting.path && !task.completed).length}</dd></div></dl><div class="qwb-summary-actions"><button on:click={() => (sharedMeetingPath = meeting.path)}>设为共享会议</button><button on:click={() => controller.openPath(meeting.path)}>打开会议</button><button on:click={() => controller.openYolo(meeting.path)}>YOLO</button></div></div>{:else}<p class="qwb-empty">请先选择会议。</p>{/each}
              {:else if dataSource(item) === "suppliers"}
                {#each selectedSupplier(item) ? [selectedSupplier(item)!] : [] as supplier}<div class="qwb-project-summary"><button class="qwb-summary-title" on:click={() => controller.openPath(supplier.path)}><span class="qwb-entity-icon supplier">S</span><span><strong>{supplier.name}</strong><small>{supplier.detail || supplier.related || "供应商"}</small></span><em>{supplier.status || "未设置"}</em></button><dl><div><dt>状态</dt><dd>{supplier.status || "未设置"}</dd></div><div><dt>关联</dt><dd>{supplier.related || "未关联"}</dd></div><div><dt>更新时间</dt><dd>{supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleDateString("zh-CN") : "未知"}</dd></div></dl><div class="qwb-summary-actions"><button on:click={() => (sharedSupplierPath = supplier.path)}>设为共享供应商</button><button on:click={() => controller.openPath(supplier.path)}>打开供应商</button><button on:click={() => controller.openYolo(supplier.path)}>YOLO</button></div></div>{:else}<p class="qwb-empty">请先选择供应商。</p>{/each}
              {:else}
                {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}<div class="qwb-project-summary"><button class="qwb-summary-title" on:click={() => controller.openPath(project.path)}><span class="qwb-entity-icon project">P</span><span><strong>{project.name}</strong><small>{projectClientLabel(project)}</small></span><em>{project.status || "开放"}</em></button><dl><div><dt>客户</dt><dd>{projectClientLabel(project)}</dd></div><div><dt>类型</dt><dd>{project.projectType || "未设置"}</dd></div><div><dt>研制阶段</dt><dd>{project.phase || "未设置"}</dd></div><div><dt>目标日期</dt><dd>{project.due || "未设置"}</dd></div><div><dt>任务</dt><dd>{projectHealth(project).completed}/{projectHealth(project).completed + projectHealth(project).open} 已完成</dd></div><div><dt>最近更新</dt><dd>{projectUpdatedLabel(project)}</dd></div></dl><div class="qwb-project-next"><small>明确下一步</small><p>{project.detail || "尚未填写明确下一步。"}</p></div><div class="qwb-summary-actions"><button disabled={sharedProjectPath === project.path} on:click={() => (sharedProjectPath = project.path)}>{sharedProjectPath === project.path ? "当前共享项目" : "设为共享项目"}</button><button on:click={() => controller.openPath(project.path)}>打开项目</button><button on:click={() => controller.openYolo(project.path)}>YOLO</button></div></div>{:else}<p class="qwb-empty">请选择或配置一个项目。</p>{/each}
              {/if}
            {:else if item.widgetId === "projects.health" || (item.widgetId === "view.metrics" && metricKind(item) === "health")}
              <div class="qwb-health-list">{#each scopedProjects(item) as project}<button on:click={() => controller.openPath(project.path)}><header><i class={projectHealth(project).level}></i><span><strong>{project.name}</strong><small>{projectClientLabel(project)}</small></span><em class={projectHealth(project).level}>{healthLabel(projectHealth(project).level)}</em></header><p>{projectHealth(project).reasons.join(" · ") || "没有发现风险信号"}</p><dl><div><dt>逾期</dt><dd>{projectHealth(project).overdue}</dd></div><div><dt>7 天内</dt><dd>{projectHealth(project).dueSoon}</dd></div><div><dt>待处理</dt><dd>{projectHealth(project).open}</dd></div><div><dt>未安排</dt><dd>{projectHealth(project).unscheduled}</dd></div></dl></button>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}</div>
            {:else if item.widgetId === "projects.progress" || (item.widgetId === "view.metrics" && metricKind(item) === "progress")}
              <div class="qwb-progress-list">{#each scopedProjects(item) as project}<button on:click={() => controller.openPath(project.path)}><header><span><strong>{project.name}</strong><small>{projectClientLabel(project)}</small></span><em>{projectHealth(project).progress}%</em></header><div class="qwb-progress-track"><i style={`width:${projectHealth(project).progress}%`}></i></div><dl><div><dt>已完成</dt><dd>{projectHealth(project).completed}</dd></div><div><dt>未完成</dt><dd>{projectHealth(project).open}</dd></div><div><dt>已逾期</dt><dd>{projectHealth(project).overdue}</dd></div><div><dt>未来 7 天</dt><dd>{projectHealth(project).dueSoon}</dd></div></dl></button>{:else}<p class="qwb-empty">暂无进度数据。</p>{/each}</div>
            {:else if item.widgetId === "projects.meetings" || (item.widgetId === "view.list" && dataSource(item) === "meetings")}
              {#if queryMode(item) === "client-meetings"}
                {#each selectedClient(item) ? [selectedClient(item)!] : [] as client}<p class="qwb-widget-hint">{client.name}的相关会议</p><div class="qwb-entity-list compact">{#each meetingsForClient(client.path) as meeting}<button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.due || meeting.status || "会议记录"}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无关联会议。</p>{/each}</div><button class="qwb-text-action" on:click={() => openCreate("meeting", client.path, "client")}>＋ 创建会议</button>{:else}<p class="qwb-empty">请先选择客户。</p>{/each}
              {:else if queryMode(item) === "all" || item.presetId === "meetings.list"}
                <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索会议" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedMeetings(item).length}</span></div><div class="qwb-entity-list compact">{#each scopedMeetings(item) as meeting}<button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.due || meeting.project || meeting.client || "会议记录"}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无会议记录。</p>{/each}</div><button class="qwb-text-action" on:click={() => openCreate("meeting")}>＋ 新建会议</button>
              {:else}
                {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}<p class="qwb-widget-hint">{project.name}的相关会议</p><div class="qwb-entity-list compact">{#each meetingsForProject(project.path) as meeting}<button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.due || meeting.status || "会议记录"}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无关联会议。</p>{/each}</div><button class="qwb-text-action" on:click={() => openCreate("meeting", project.path)}>＋ 创建会议</button>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}
              {/if}
            {:else if item.widgetId === "projects.actions" || (item.widgetId === "view.list" && queryMode(item) === "meeting-actions")}
              <div class="qwb-task-list">{#each scopedTasks(item).filter((task) => task.scope === "meeting-draft") as task (task.id)}<div class="qwb-task-row qwb-task-row-no-check"><button class="qwb-link" title={task.text} on:click={() => controller.openPath(task.path)}><span class="qwb-task-title-text">{task.text}</span></button><div class="qwb-task-meta"><span class="qwb-task-source" title={task.sourceName}><em>{task.sourceName}</em></span>{#if task.due}<time>{task.due}</time>{/if}</div><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button></div>{:else}<p class="qwb-empty">没有待迁移的会议行动。</p>{/each}</div>{#if scopedTasks(item).some((task) => task.scope === "meeting-draft")}<button class="qwb-text-action" on:click={() => openMigration()}>批量迁移全部会议行动</button>{/if}
            {:else if item.widgetId === "projects.risks" || (item.widgetId === "view.list" && dataSource(item) === "projects" && queryMode(item) === "risks")}
              <div class="qwb-risk-list">{#each scopedProjects(item).filter((project) => projectHealth(project).level !== "healthy") as project}<button on:click={() => controller.openPath(project.path)}><strong>{project.name}</strong><span>{#each projectHealth(project).reasons as reason}<small>{reason}</small>{:else}<small>项目信息不足，暂时无法判断。</small>{/each}</span><em class={projectHealth(project).level}>{healthLabel(projectHealth(project).level)}</em></button>{:else}<p class="qwb-empty">当前没有识别到项目风险。</p>{/each}</div>
            {:else if item.widgetId === "projects.activity" || (item.widgetId === "view.timeline" && queryMode(item) === "project-activity")}
              <div class="qwb-activity-list">{#each [...scopedProjects(item).map((project) => ({ ...project, activityType: "项目" })), ...snapshot.meetings.map((meeting) => ({ ...meeting, activityType: "会议" }))].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)).slice(0, configLimit(item)) as entry}<button on:click={() => controller.openPath(entry.path)}><time>{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString("zh-CN") : ""}</time><span><strong>{entry.name}</strong><small>{entry.activityType} · {entry.detail || entry.status || "最近修改"}</small></span></button>{:else}<p class="qwb-empty">暂无最近动态。</p>{/each}</div>
            {:else if item.widgetId === "projects.relations" || item.widgetId === "view.relations"}
              {#if dataSource(item) === "clients"}
                {#each selectedClient(item) ? [selectedClient(item)!] : [] as client}<div class="qwb-relations"><section><strong>项目</strong>{#each projectsForClient(client.path).slice(0, 6) as project}<button on:click={() => controller.openPath(project.path)}>{project.name}</button>{:else}<span>暂无</span>{/each}</section><section><strong>会议</strong>{#each meetingsForClient(client.path).slice(0, 6) as meeting}<button on:click={() => controller.openPath(meeting.path)}>{meeting.name}</button>{:else}<span>暂无</span>{/each}</section><section><strong>未完成行动</strong>{#each tasksForClient(client.path).slice(0, 6) as task}<button on:click={() => controller.openPath(task.path)}>{task.text}</button>{:else}<span>暂无</span>{/each}</section></div>{:else}<p class="qwb-empty">请先选择客户。</p>{/each}
              {:else if dataSource(item) === "meetings"}
                {#each selectedMeeting(item) ? [selectedMeeting(item)!] : [] as meeting}<div class="qwb-relations"><section><strong>项目</strong>{#each resolveProject(meeting.project) ? [resolveProject(meeting.project)!] : [] as project}<button on:click={() => controller.openPath(project.path)}>{project.name}</button>{:else}<span>未关联</span>{/each}</section><section><strong>客户</strong>{#each resolveEntityReference(meeting.client, snapshot.clients) ? [resolveEntityReference(meeting.client, snapshot.clients)!] : [] as client}<button on:click={() => controller.openPath(client.path)}>{client.name}</button>{:else}<span>未关联</span>{/each}</section><section><strong>行动项</strong>{#each snapshot.tasks.filter((task) => task.path === meeting.path && !task.completed).slice(0, 8) as task}<button on:click={() => controller.openPath(task.path)}>{task.text}</button>{:else}<span>暂无</span>{/each}</section></div>{:else}<p class="qwb-empty">请先选择会议。</p>{/each}
              {:else if dataSource(item) === "suppliers"}
                {#each selectedSupplier(item) ? [selectedSupplier(item)!] : [] as supplier}<div class="qwb-relations"><section><strong>已记录关联</strong><span>{supplier.related || "暂无"}</span></section><section><strong>相关项目</strong>{#each snapshot.projects.filter((project) => JSON.stringify(project).includes(supplier.name)).slice(0, 6) as project}<button on:click={() => controller.openPath(project.path)}>{project.name}</button>{:else}<span>暂无明确关联</span>{/each}</section><section><strong>相关会议</strong>{#each snapshot.meetings.filter((meeting) => JSON.stringify(meeting).includes(supplier.name)).slice(0, 6) as meeting}<button on:click={() => controller.openPath(meeting.path)}>{meeting.name}</button>{:else}<span>暂无明确关联</span>{/each}</section></div>{:else}<p class="qwb-empty">请先选择供应商。</p>{/each}
              {:else}
                {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}<div class="qwb-relations"><section><strong>客户</strong>{#each resolveEntityReference(project.client, snapshot.clients) ? [resolveEntityReference(project.client, snapshot.clients)!] : [] as client}<button on:click={() => controller.openPath(client.path)}>{client.name}</button>{:else}<span>未关联</span>{/each}</section><section><strong>会议</strong>{#each meetingsForProject(project.path).slice(0, 6) as meeting}<button on:click={() => controller.openPath(meeting.path)}>{meeting.name}</button>{:else}<span>暂无</span>{/each}</section><section><strong>知识</strong>{#each relatedKnowledge(project.path).slice(0, 6) as note}<button on:click={() => controller.openPath(note.path)}>{note.name}</button>{:else}<span>暂无</span>{/each}</section></div>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}
              {/if}
            {:else if item.widgetId === "projects.quick-actions" || item.widgetId === "control.actions"}
              {#if dataSource(item) === "clients"}
                <div class="qwb-create-grid"><button on:click={() => openCreate("client")}><span>＋</span>新建客户</button><button disabled={!selectedClient(item)} on:click={() => selectedClient(item) && openCreate("project", selectedClient(item)!.path, "client")}><span>＋</span>客户项目</button><button disabled={!selectedClient(item)} on:click={() => selectedClient(item) && openCreate("meeting", selectedClient(item)!.path, "client")}><span>＋</span>客户会议</button><button disabled={!selectedClient(item)} on:click={() => selectedClient(item) && controller.openPath(selectedClient(item)!.path)}><span>↗</span>打开客户</button></div><button class="qwb-button qwb-button-primary qwb-full" disabled={!selectedClient(item)} on:click={() => selectedClient(item) && controller.openYolo(selectedClient(item)!.path)}>用当前客户打开 YOLO</button>
              {:else if dataSource(item) === "meetings"}
                <div class="qwb-create-grid"><button on:click={() => openCreate("meeting")}><span>＋</span>新建会议</button><button disabled={!selectedMeeting(item)} on:click={() => selectedMeeting(item) && controller.openPath(selectedMeeting(item)!.path)}><span>↗</span>打开会议</button><button disabled={!selectedMeeting(item)} on:click={() => selectedMeeting(item) && openMigration()}><span>⇢</span>迁移行动</button></div><button class="qwb-button qwb-button-primary qwb-full" disabled={!selectedMeeting(item)} on:click={() => selectedMeeting(item) && controller.openYolo(selectedMeeting(item)!.path)}>用当前会议打开 YOLO</button>
              {:else if dataSource(item) === "suppliers"}
                <div class="qwb-create-grid"><button on:click={() => openCreate("supplier")}><span>＋</span>新建供应商</button><button disabled={!selectedSupplier(item)} on:click={() => selectedSupplier(item) && controller.openPath(selectedSupplier(item)!.path)}><span>↗</span>打开供应商</button></div><button class="qwb-button qwb-button-primary qwb-full" disabled={!selectedSupplier(item)} on:click={() => selectedSupplier(item) && controller.openYolo(selectedSupplier(item)!.path)}>用当前供应商打开 YOLO</button>
              {:else}
                <div class="qwb-create-grid"><button on:click={() => openCreate("project")}><span>＋</span>新建项目</button><button on:click={() => openTask(scopedProjectPath(item))}><span>＋</span>项目任务</button><button on:click={() => openCreate("meeting", scopedProjectPath(item))}><span>＋</span>项目会议</button><button disabled={!selectedProject(item)} on:click={() => selectedProject(item) && controller.openPath(selectedProject(item)!.path)}><span>↗</span>打开项目</button></div><button class="qwb-button qwb-button-primary qwb-full" disabled={!selectedProject(item)} on:click={() => selectedProject(item) && controller.openYolo(selectedProject(item)!.path)}>用当前项目打开 YOLO</button>
              {/if}
            {:else if item.widgetId === "projects.milestones" || (item.widgetId === "view.list" && dataSource(item) === "projects" && queryMode(item) === "milestones")}
              <div class="qwb-entity-list compact">
                {#each snapshot.projects.filter((project) => project.due).sort((left, right) => (left.due ?? "").localeCompare(right.due ?? "")).slice(0, 10) as project}
                  <button on:click={() => controller.openPath(project.path)}><span class="qwb-entity-icon project">◆</span><span><strong>{project.name}</strong><small>{project.phase || "当前阶段"} · {project.due}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">开放项目尚未设置里程碑或截止日期。</p>{/each}
              </div>
            {:else if item.widgetId.startsWith("projects.")}
              <div class="qwb-entity-list">
                {#each snapshot.projects.slice(0, 12) as project}
                  <button on:click={() => controller.openPath(project.path)}>
                    <span class="qwb-entity-icon project">P</span><span><strong>{project.name}</strong><small>{project.phase || project.status || "开放项目"}{project.detail ? ` · ${project.detail}` : ""}</small></span>
                    <i>›</i>
                  </button>
                {:else}
                  <p class="qwb-empty">未发现开放项目。请先检查项目目录配置。</p>
                {/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("project")}>＋ 新建项目</button>
            {:else if item.widgetId.startsWith("meetings.")}
              <div class="qwb-scope-section">
                <div class="qwb-section-title"><span class="qwb-scope meeting">待迁移行动项</span><strong>{tasksByScope("meeting-draft").length}</strong></div>
                {#each tasksByScope("meeting-draft").slice(0, 6) as task}<div class="qwb-task-row qwb-task-row-no-check"><button class="qwb-link" title={task.text} on:click={() => controller.openPath(task.path)}><span class="qwb-task-title-text">{task.text}</span></button><div class="qwb-task-meta"><span class="qwb-task-source" title={task.sourceName}><em>{task.sourceName}</em></span>{#if task.due}<time>{task.due}</time>{/if}</div><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button></div>{/each}
              </div>
              <div class="qwb-entity-list compact">
                {#each snapshot.meetings.slice(0, 8) as meeting}
                  <button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.related || "会议记录"}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">暂无会议记录。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("meeting")}>＋ 新建会议</button>
            {:else if item.widgetId === "view.list" && dataSource(item) === "clients"}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索客户名称、别名或业务领域" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{clientRowsForWidget(item).length}</span></div>
              <div class="qwb-client-list">{#each clientRowsForWidget(item) as client}<button on:click={() => controller.openPath(client.path)}><span class="qwb-entity-icon client">C</span><span><strong>{client.name}</strong><small>{client.organizationType || client.businessDomains || "客户"}</small></span><em>{client.relationshipStatus || "未设置关系"}</em><time>{clientFollowupLabel(client)}</time></button>{:else}<p class="qwb-empty">暂无匹配客户。</p>{/each}</div>
              <button class="qwb-text-action" on:click={() => openCreate("client")}>＋ 新建客户</button>
            {:else if item.widgetId === "view.list" && dataSource(item) === "suppliers"}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索供应商" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedSuppliers(item).length}</span></div><div class="qwb-client-list">{#each scopedSuppliers(item) as supplier}<button on:click={() => controller.openPath(supplier.path)}><span class="qwb-entity-icon supplier">S</span><span><strong>{supplier.name}</strong><small>{supplier.detail || supplier.related || "供应商"}</small></span><em>{supplier.status || "未设置"}</em><time>{supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleDateString("zh-CN") : ""}</time></button>{:else}<p class="qwb-empty">暂无供应商。</p>{/each}</div><button class="qwb-text-action" on:click={() => openCreate("supplier")}>＋ 新建供应商</button>
            {:else if item.widgetId === "view.list" && dataSource(item) === "knowledge"}
              <div class="qwb-entity-list">{#each snapshot.knowledge.slice(0, configLimit(item)) as entry}<button on:click={() => controller.openPath(entry.path)}><span class="qwb-entity-icon knowledge">K</span><span><strong>{entry.name}</strong><small>{entry.status || "待处理"}{entry.related ? ` · ${entry.related}` : ""}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无知识条目。</p>{/each}</div>
            {:else if item.widgetId.startsWith("clients.")}
              <div class="qwb-entity-list compact">
                {#each snapshot.clients.slice(0, 8) as client}
                  <button on:click={() => controller.openPath(client.path)}><span class="qwb-entity-icon client">C</span><span><strong>{client.name}</strong><small>{client.status || "客户"}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">暂无客户记录。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("client")}>＋ 新建客户</button>
            {:else if item.widgetId.startsWith("suppliers.")}
              <div class="qwb-entity-list compact">
                {#each snapshot.suppliers.slice(0, 8) as supplier}
                  <button on:click={() => controller.openPath(supplier.path)}><span class="qwb-entity-icon supplier">S</span><span><strong>{supplier.name}</strong><small>{supplier.status || "供应商"}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">暂无供应商记录。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("supplier")}>＋ 新建供应商</button>
            {:else if item.widgetId.startsWith("knowledge.")}
              <p class="qwb-widget-hint">{knowledgeHint(item.widgetId)}</p>
              {#if item.widgetId === "knowledge.inbox"}
                <div class="qwb-knowledge-summary">
                  {#each ["待处理", "待沉淀", "待读", "已归档", "重复"] as status}
                    <div><strong>{snapshot.knowledge.filter((entry) => entry.status === status).length}</strong><span>{status}</span></div>
                  {/each}
                </div>
              {/if}
              <div class="qwb-entity-list">
                {#each knowledgeForWidget(item.widgetId).filter((entry) => item.widgetId === "knowledge.recent" || entry.status !== "已归档").slice(0, 10) as entry}
                  <div class="qwb-knowledge-row"><button on:click={() => controller.openPath(entry.path)}><span class="qwb-entity-icon knowledge">K</span><span><strong>{entry.name}</strong><small>{entry.status || "待处理"}{entry.related ? ` · ${entry.related}` : ""}</small></span><i>›</i></button><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openKnowledge(entry.path, entry.status)}>处理</button></div>
                {:else}<p class="qwb-empty">知识收件箱已清空。</p>{/each}
              </div>
            {:else if item.widgetId === "core.diagnostics"}
              <div class="qwb-diagnostics">
                {#each snapshot.diagnostics as diagnostic}
                  <div class={diagnostic.status}><i></i><span><strong>{diagnostic.label}</strong><small>{diagnostic.detail}</small></span></div>
                {:else}<p class="qwb-empty">点击刷新运行诊断。</p>{/each}
              </div>
              {#if snapshot.transactionHistory.length}
                <div class="qwb-transaction-history">
                  <div class="qwb-section-title"><span>最近事务</span><strong>{snapshot.transactionHistory.length}</strong></div>
                  {#each snapshot.transactionHistory.slice(0, 5) as receipt}
                    <details class:warning={receipt.status === "partial" || receipt.status === "failed"}>
                      <summary>{receipt.label} · {receipt.status}</summary>
                      <small>{receipt.affectedPaths.join("、")}</small>
                      {#each receipt.messages as note}<p>{note}</p>{/each}
                    </details>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </section>
    {/each}
    </div>

    {#if layoutEditMode && items.some((item) => item.hidden)}
      <footer class="qwb-hidden-widgets">
        <span>已隐藏</span>
        {#each items.filter((item) => item.hidden) as item}
          <button on:click={() => setItemState(itemKey(item), { hidden: false })}>＋ {widgetTitle(item)}</button>
        {/each}
      </footer>
    {/if}
  {/key}
</div>

{#if showWidgetLibrary}
  <div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (showWidgetLibrary = false)}>
    <div class="qwb-modal qwb-widget-library" role="dialog" aria-modal="true" aria-labelledby="qwb-widget-library-title">
      <header><div><span class="qwb-eyebrow">COMPONENT LIBRARY</span><h2 id="qwb-widget-library-title">{selectedWidgetType ? `配置${BUILTIN_WIDGETS.find((widget) => widget.id === selectedWidgetType)?.title ?? "组件"}` : "选择组件类型"}</h2></div><button aria-label="关闭" on:click={() => (showWidgetLibrary = false)}>×</button></header>
      <div class="qwb-modal-body">
      {#if !selectedWidgetType}
        <input class="qwb-library-search" bind:value={widgetLibrarySearch} placeholder="搜索列表、看板、日历等组件类型" />
        <nav class="qwb-library-packs"><button class:active={widgetLibraryPack === "all"} on:click={() => (widgetLibraryPack = "all")}>全部</button><button class:active={widgetLibraryPack === "view"} on:click={() => (widgetLibraryPack = "view")}>视图</button><button class:active={widgetLibraryPack === "control"} on:click={() => (widgetLibraryPack = "control")}>控制</button><button class:active={widgetLibraryPack === "capture"} on:click={() => (widgetLibraryPack = "capture")}>记录</button></nav>
        <div class="qwb-library-grid qwb-library-types">
          {#each visibleWidgetLibraryItems as widget (widget.id)}
            <button on:click={() => (selectedWidgetType = widget.id)}><i use:obsidianIcon={widgetTypeIconName(widget.id)}></i><span><strong>{widget.title}</strong><small>{widget.description || widget.id}</small></span><em>{widget.defaultSize.width}×{widget.defaultSize.height}</em></button>
          {:else}<p class="qwb-empty">没有匹配组件类型。</p>{/each}
        </div>
      {:else}
        <button class="qwb-library-back" on:click={() => (selectedWidgetType = "")}>← 返回组件类型</button>
        {#if selectedWidgetType === "control.selector"}<p class="qwb-library-explainer"><strong>选择器是联动控制器。</strong>它发布一个共享项目、客户、会议或供应商；设置为“跟随同类选择器”的摘要、健康度、任务与会议组件会一起切换。</p>{/if}
        <div class="qwb-library-grid qwb-library-presets">
          <button on:click={() => run(() => addWidget(selectedWidgetType), "已添加空白组件")}><i use:obsidianIcon={widgetTypeIconName(selectedWidgetType)}></i><span><strong>空白组件</strong><small>从默认数据源开始，自行配置名称和筛选。</small></span><em>自定义</em></button>
          {#each presetsForType(selectedWidgetType) as preset (preset.id)}
            <button on:click={() => run(() => addWidget(selectedWidgetType, preset.id), `已添加「${preset.title}」`)}><i use:obsidianIcon={widgetTypeIconName(selectedWidgetType)}></i><span><strong>{preset.title}</strong><small>{preset.description}</small></span><em>预设</em></button>
          {/each}
        </div>
      {/if}
      <p class="qwb-library-note">同一种组件可以重复添加；每个实例的筛选、数据范围和尺寸分别保存。</p>
      </div>
    </div>
  </div>
{/if}

{#if editingWidget}
  <div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (editingWidget = undefined)}>
    <div class="qwb-modal qwb-widget-settings" role="dialog" aria-modal="true" aria-labelledby="qwb-widget-settings-title">
      <header><div><span class="qwb-eyebrow">WIDGET INSTANCE</span><h2 id="qwb-widget-settings-title">{widgetTitle(editingWidget)}设置</h2></div><button aria-label="关闭" on:click={() => (editingWidget = undefined)}>×</button></header>
      <div class="qwb-modal-body qwb-dialog-form">
      <label>组件名称<input bind:value={editingTitle} placeholder="例如：客户 A 待跟进" /></label>
      <fieldset class="qwb-widget-size-editor">
        <legend>组件尺寸</legend>
        <label>宽度<select bind:value={editingCols}><option value={1}>窄 · 1 列</option><option value={2}>标准 · 2 列</option><option value={3}>宽 · 3 列</option><option value={4}>整行 · 4 列</option></select></label>
        <label>高度<select bind:value={editingRows}>{#each [1, 2, 3, 4, 5, 6, 7, 8] as row}<option value={row}>{row === 1 ? "紧凑" : row === 2 ? "标准" : `${row} 行`}</option>{/each}</select></label>
        <small>布局按阅读顺序自动排列，不再需要拖到精确坐标。</small>
      </fieldset>
      {#if editingWidget.widgetId.startsWith("view.") || editingWidget.widgetId.startsWith("control.") || editingWidget.widgetId.startsWith("tasks.") || editingWidget.widgetId.startsWith("projects.")}
        <label>数据源<select value={String(configSection(editingConfig, "source").kind ?? (editingWidget.widgetId.startsWith("projects.") ? "projects" : "tasks"))} on:change={(event) => updateEditingSource({ kind: (event.currentTarget as HTMLSelectElement).value })}><option value="tasks">任务</option><option value="projects">项目</option><option value="clients">客户</option><option value="suppliers">供应商</option><option value="meetings">会议</option><option value="knowledge">知识</option><option value="mixed">混合</option></select></label>
        <label>数据范围<select value={String(configSection(editingConfig, "source").scopeMode ?? editingConfig.scopeMode ?? "all")} on:change={(event) => updateEditingSource({ scopeMode: (event.currentTarget as HTMLSelectElement).value })}><option value="all">全部数据</option><option value="shared">跟随同类选择器</option><option value="context">跟随当前笔记</option><option value="fixed">固定实体</option></select></label>
        {#if (configSection(editingConfig, "source").scopeMode ?? editingConfig.scopeMode) === "fixed"}
          {#if String(configSection(editingConfig, "source").kind ?? "tasks") === "clients"}
            <SearchableSelect id="qwb-widget-fixed-client" label="固定客户" value={String(configSection(editingConfig, "source").clientPath ?? editingConfig.clientPath ?? "")} options={clientOptions()} emptyLabel="不固定客户" onSelect={(value) => updateEditingSource({ clientPath: value })} />
          {:else if String(configSection(editingConfig, "source").kind ?? "tasks") === "meetings"}
            <SearchableSelect id="qwb-widget-fixed-meeting" label="固定会议" value={String(configSection(editingConfig, "source").meetingPath ?? "")} options={meetingOptions()} emptyLabel="不固定会议" onSelect={(value) => updateEditingSource({ meetingPath: value })} />
          {:else if String(configSection(editingConfig, "source").kind ?? "tasks") === "suppliers"}
            <SearchableSelect id="qwb-widget-fixed-supplier" label="固定供应商" value={String(configSection(editingConfig, "source").supplierPath ?? "")} options={supplierOptions()} emptyLabel="不固定供应商" onSelect={(value) => updateEditingSource({ supplierPath: value })} />
          {:else}
            <SearchableSelect id="qwb-widget-fixed-project" label="固定项目" value={String(configSection(editingConfig, "source").projectPath ?? editingConfig.projectPath ?? "")} options={projectOptions()} emptyLabel="不固定项目" onSelect={(value) => updateEditingSource({ projectPath: value })} />
          {/if}
        {/if}
        <SearchableSelect id="qwb-widget-client-filter" label="客户筛选" value={String(configSection(editingConfig, "source").clientPath ?? editingConfig.clientPath ?? "")} options={clientOptions()} emptyLabel="全部客户" onSelect={(value) => updateEditingSource({ clientPath: value })} />
        <label>项目类型<select value={String(configSection(editingConfig, "source").projectType ?? editingConfig.projectType ?? "")} on:change={(event) => updateEditingSource({ projectType: (event.currentTarget as HTMLSelectElement).value })}><option value="">全部类型</option>{#each focusProjectTypes() as projectType}<option value={projectType}>{projectType}</option>{/each}</select></label>
        {#if String(configSection(editingConfig, "source").kind ?? "tasks") === "clients"}
          <label>关系状态<select value={String(configSection(editingConfig, "query").relationshipStatus ?? "")} on:change={(event) => updateEditingQuery({ relationshipStatus: (event.currentTarget as HTMLSelectElement).value })}><option value="">全部关系状态</option>{#each clientRelationshipStatuses() as status}<option value={status}>{status}</option>{/each}</select></label>
          <label>机构类型<select value={String(configSection(editingConfig, "query").organizationType ?? "")} on:change={(event) => updateEditingQuery({ organizationType: (event.currentTarget as HTMLSelectElement).value })}><option value="">全部机构类型</option>{#each clientOrganizationTypes() as type}<option value={type}>{type}</option>{/each}</select></label>
        {/if}
        <label>最多显示<input type="number" min="1" max="200" value={Number(configSection(editingConfig, "query").limit ?? editingConfig.limit ?? 30)} on:input={(event) => updateEditingQuery({ limit: Number((event.currentTarget as HTMLInputElement).value) || 30 })} /></label>
        {#if String(configSection(editingConfig, "source").kind ?? "tasks") === "tasks" || editingWidget.widgetId.startsWith("tasks.")}
          <fieldset><legend>任务来源</legend>{#each [["project", "项目"], ["client", "客户"], ["meeting-draft", "会议草稿"]] as option}<label class="qwb-inline-check"><input type="checkbox" checked={editingTaskScopes().includes(option[0])} on:change={() => toggleEditingTaskScope(option[0] as TaskRecord["scope"])} />{option[1]}</label>{/each}</fieldset>
          <label class="qwb-inline-check"><input type="checkbox" checked={Boolean(configSection(editingConfig, "query").includeCompleted ?? editingConfig.includeCompleted)} on:change={(event) => updateEditingQuery({ includeCompleted: (event.currentTarget as HTMLInputElement).checked })} />包括已完成任务</label>
        {/if}
      {:else}
        <p class="qwb-empty">这个组件当前没有实例级筛选设置。</p>
      {/if}
      <div class="qwb-modal-actions"><button class="qwb-button qwb-danger-button" on:click={() => run(async () => { await removeWidget(editingWidget!); editingWidget = undefined; }, "组件已移除")}>移除组件</button><span></span><button class="qwb-button qwb-button-subtle" on:click={() => (editingWidget = undefined)}>取消</button><button class="qwb-button qwb-button-primary" on:click={() => run(saveWidgetSettings, "组件设置已保存")}>保存</button></div>
      </div>
    </div>
  </div>
{/if}

{#if dialog}
  <div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (dialog = null)}>
    <div class="qwb-modal" class:qwb-note-modal={dialog === "note"} role="dialog" aria-modal="true" aria-labelledby="qwb-dialog-title">
      <header><div><span class="qwb-eyebrow">{dialog === "note" ? "PROJECT NOTE" : "SAFE WORKFLOW"}</span><h2 id="qwb-dialog-title">{dialogTitle(dialog)}</h2>{#if dialog === "note"}<p>把方案过程、关键判断和下一步沉淀到项目上下文中。</p>{/if}</div><button aria-label="关闭" on:click={() => (dialog = null)}>×</button></header>
      <div class="qwb-modal-body" class:qwb-dialog-form={dialog !== "note"}>
      {#if !controller.settings.writesEnabled}
        <div class="qwb-inline-warning">写入尚未启用。请先在插件设置中阅读说明并确认。</div>
      {/if}
      {#if dialog === "note"}
        <form class="qwb-dialog-form qwb-note-form" on:submit|preventDefault={submitNote}>
          <section class="qwb-note-section">
            <div class="qwb-note-section-heading"><div><h3>笔记内容</h3><p>标题用于检索，正文可以先记录最小必要信息。</p></div><span>必填</span></div>
            <label class="qwb-note-title-field">标题<input bind:this={noteTitleInput} bind:value={noteTitle} placeholder="例如：XX 项目热控方案讨论" /></label>
            <label>正文（可选）<textarea bind:value={noteBody} rows="7" placeholder="记录背景、判断、结论或下一步……"></textarea></label>
          </section>

          <section class="qwb-note-section">
            <div class="qwb-note-section-heading"><div><h3>关联对象</h3><p>优先关联项目；客户用于补充业务上下文。</p></div><span>可选</span></div>
            <SearchableSelect id="qwb-note-project" label="关联项目（推荐）" bind:value={noteProject} options={projectOptions()} emptyLabel="暂不关联项目" help="可按项目名称、客户、状态或路径搜索。" />
            <SearchableSelect id="qwb-note-client" label="关联客户" bind:value={noteClient} options={clientOptions()} emptyLabel="暂不关联客户" help="项目已经明确时，客户可以留空。" />
          </section>

          <details class="qwb-note-location">
            <summary><span><strong>保存位置</strong><small>{noteTargetPath()}</small></span><em>调整</em></summary>
            <label>目录<input bind:value={noteFolder} list="qwb-note-folder-options" placeholder="留空则保存到库根目录" /></label>
            <datalist id="qwb-note-folder-options">{#each noteFolderSuggestions() as folder}<option value={folder}></option>{/each}</datalist>
          </details>

          <div class="qwb-note-receipt" aria-live="polite"><span>写入后将自动打开</span><strong>{noteProject ? relationLabel(noteProject) : "未关联项目"}</strong><small>{noteClient ? `客户：${relationLabel(noteClient)}` : "客户：未关联"}</small></div>
          <div class="qwb-modal-actions"><button type="button" class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button type="submit" class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !noteTitle.trim() || busy}>{busy ? "创建中…" : "创建项目笔记"}</button></div>
        </form>
      {:else if dialog === "entity"}
        <label>类型<select bind:value={entityKind}><option value="project">项目</option><option value="client">客户</option><option value="meeting">会议</option><option value="supplier">供应商</option></select></label>
        <label>名称<input bind:value={entityName} placeholder="输入清晰、可检索的名称" /></label>
        {#if entityKind === "project"}<SearchableSelect id="qwb-entity-client" label="关联客户" bind:value={relatedClient} options={clientOptions()} emptyLabel="暂不关联客户" /><button class="qwb-text-action" type="button" on:click={() => beginNestedEntity("client")}>＋ 没有客户？先创建客户</button>{/if}
        {#if entityKind === "meeting"}<SearchableSelect id="qwb-entity-project" label="关联项目" bind:value={relatedProject} options={projectOptions()} emptyLabel="暂不关联项目" /><button class="qwb-text-action" type="button" on:click={() => beginNestedEntity("project")}>＋ 没有项目？先创建项目</button><SearchableSelect id="qwb-meeting-client" label="关联客户（可选）" bind:value={relatedClient} options={clientOptions()} emptyLabel="暂不关联客户" /><label>日期<input type="date" bind:value={entityDate} /></label><div class="qwb-form-row"><label>开始时间<input type="time" bind:value={entityStartTime} /></label><label>结束时间<input type="time" min={entityStartTime || undefined} bind:value={entityEndTime} /></label></div>{/if}
        <div class="qwb-inline-preview"><strong>写入预览</strong><div>{entityTargetFolder()}/{entityKind === "meeting" && entityDate ? `${entityDate} ` : ""}{entityName || "未命名"}.md</div><small>确认后仍会执行模板、重名与路径预检。</small></div>
        <button class="qwb-text-action" type="button" disabled={!entityName.trim() || busy} on:click={() => run(previewEntityTemplate, "模板预览已生成")}>生成完整模板预览</button>
        {#if entityTemplatePreview}<pre class="qwb-template-preview">{entityTemplatePreview}</pre>{/if}
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !entityName.trim() || busy} on:click={submitEntity}>确认创建</button></div>
      {:else if dialog === "task"}
        <SearchableSelect id="qwb-task-project" label="项目" bind:value={projectPath} options={projectOptions()} emptyLabel="尚未选择项目" />
        <label>任务<textarea bind:value={taskText} rows="3" placeholder="描述下一步具体行动"></textarea></label>
        <div class="qwb-form-row"><label>截止日期<input type="date" bind:value={taskDue} /></label><label>优先级<select bind:value={taskPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label></div>
        <div class="qwb-inline-preview"><strong>写入预览</strong><div>{taskText || "未填写任务"}{taskDue ? ` · 截止 ${taskDue}` : ""}</div><small>{projectPath ? relationLabel(projectPath) : "尚未选择项目"}</small></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button>{#if controller.tasksIntegrationAvailable()}<button class="qwb-button" disabled={!controller.settings.writesEnabled || !projectPath || busy} on:click={submitTaskWithTasks}>Tasks 高级新建</button>{/if}<button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !projectPath || !taskText.trim() || busy} on:click={submitTask}>添加任务</button></div>
      {:else if dialog === "task-edit"}
        {#if taskEditReason}<div class="qwb-inline-warning">{taskEditReason}</div>{/if}
        <p>{selectedTask?.text}</p>
        <div class="qwb-form-row"><label>截止日期<input type="date" bind:value={taskDue} /></label><label>优先级<select bind:value={taskPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || busy} on:click={submitTaskEdit}>保存</button></div>
      {:else if dialog === "schedule"}
        <p class="qwb-schedule-task">{selectedTask?.text}</p>
        <label>计划日期<input type="date" bind:value={taskScheduled} /></label>
        <div class="qwb-inline-preview"><strong>日期职责保持分离</strong><div>计划日期使用 Tasks 的 ⏳ 字段；原有 📅 截止日期不会改变。</div><small>保存后可在 Full Calendar 中继续拖到具体时间段。</small></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button" on:click={() => run(() => controller.openCalendar())}>打开完整日程</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !taskScheduled || busy} on:click={submitTaskSchedule}>保存计划日期</button></div>
      {:else if dialog === "migrate"}
        <p>预览：将 {migrationTasks.length} 条会议草稿迁移到同一目标项目或客户。每条行动都有独立回执；成功项写入稳定来源标记，重复执行不会重复创建。</p>
        <div class="qwb-inline-preview">{#each migrationTasks.slice(0, 8) as task}<div>• {task.text} <small>{task.sourceName}</small></div>{/each}</div>
        <SearchableSelect id="qwb-migration-target" label="迁移目标" bind:value={migrationTarget} options={migrationOptions()} emptyLabel="尚未选择目标" placeholder="输入项目或客户名称" />
        {#if migrationBatch}
          <div class="qwb-migration-receipt" class:partial={migrationBatch.status !== "completed"}>
            <strong>批次 {migrationBatch.status === "completed" ? "已完成" : migrationBatch.status === "partial" ? "部分完成" : "失败"}</strong>
            <small>已迁移 {migrationBatch.migratedCount} · 已存在 {migrationBatch.alreadyMigratedCount} · 失败 {migrationBatch.failedCount} · 跳过 {migrationBatch.skippedCount}</small>
            {#each migrationBatch.items as result}<div><span>{result.outcome === "migrated" ? "✓" : result.outcome === "already-migrated" ? "↷" : "!"}</span><code>{result.sourcePath}</code><em>{result.message || result.outcome}</em></div>{/each}
            {#if migrationBatch.manualRepairPaths.length}<p>需要人工检查：{migrationBatch.manualRepairPaths.join("、")}</p>{/if}
          </div>
        {/if}
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>关闭</button>{#if migrationBatch?.retryItems.length}<button class="qwb-button" disabled={busy} on:click={retryMigration}>继续恢复 {migrationBatch.retryItems.length} 条</button>{/if}<button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !migrationTarget || busy || migrationBatch?.status === "completed"} on:click={submitMigration}>{migrationBatch ? "重新运行批次" : "预检并迁移"}</button></div>
      {:else if dialog === "knowledge"}
        <label>处理状态<select bind:value={knowledgeStatus}><option>待处理</option><option>待沉淀</option><option>待读</option><option>已归档</option><option>重复</option></select></label>
        <SearchableSelect id="qwb-knowledge-project" label="关联项目" bind:value={knowledgeProject} options={projectOptions()} emptyLabel="暂不关联项目" />
        <div class="qwb-inline-preview"><strong>状态处理</strong><small>只更新来源笔记的 triage_status 与项目关联，不改变现有模板。</small></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button" disabled={!controller.settings.writesEnabled || busy} on:click={submitKnowledge}>仅保存状态</button></div>
        <hr />
        <label>正式知识标题<input bind:value={knowledgePublishTitle} /></label>
        <div class="qwb-inline-preview"><strong>发布目标</strong><div>{controller.settings.formalKnowledgeFolder}/{knowledgePublishTitle || "未命名"}.md</div><small>{controller.settings.knowledgeTemplate ? `只读模板：${controller.settings.knowledgeTemplate}` : "使用插件内置安全模板"}</small></div>
        {#if knowledgePublication}<pre class="qwb-template-preview">{knowledgePublication.targetPath}\n\n{knowledgePublication.targetContent}</pre>{/if}
        <div class="qwb-modal-actions"><button class="qwb-button" disabled={!knowledgePublishTitle.trim() || busy} on:click={previewKnowledgePublication}>生成发布预览</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !knowledgePublication || busy} on:click={publishKnowledge}>确认发布</button></div>
      {:else if dialog === "yolo-preview"}
        <p>以下内容会复制到剪贴板并打开 YOLO。此步骤本身不修改任何 Markdown；请在 YOLO 给出安排后再决定是否执行。</p>
        <textarea class="qwb-yolo-preview" rows="14" readonly value={yoloPrompt}></textarea>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={busy} on:click={() => run(confirmYolo, "提示词已复制并打开 YOLO")}>复制并打开 YOLO</button></div>
      {/if}
      </div>
    </div>
  </div>
{/if}
