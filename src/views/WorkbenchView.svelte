<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { Platform, setIcon } from "obsidian";
  import type { EntityKind, LayoutItem, TaskRecord } from "../core/types";
  import type {
    AddProjectTaskInput,
    CreateEntityInput,
    WorkbenchController,
    WorkbenchSnapshot
  } from "../ui/controller";
  import { EMPTY_SNAPSHOT } from "../ui/controller";
  import { formatDate } from "../services/template-service";
  import { layoutItemKey } from "../core/layout";
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
    dateAfter,
    effectiveTaskDate,
    isRecurringTask,
    isWaitingTask,
    taskQuadrant,
    taskTimeBucket,
    type TaskQuadrant,
    type TaskTimeBucket
  } from "../domain/widget-data";

  export let controller: WorkbenchController;

  type SceneId = string;
  type DialogKind = "entity" | "task" | "task-edit" | "migrate" | "knowledge" | null;
  type MoveMode = "move" | "resize";
  const UI_VERSION = "0.5.9";

  interface SceneDefinition {
    id: SceneId;
    name: string;
    description: string;
    icon: string;
    items: LayoutItem[];
  }

  interface SceneMetric {
    label: string;
    value: number;
  }

  interface EntityDraft {
    kind: Exclude<EntityKind, "knowledge">;
    name: string;
    relatedClient: string;
    relatedProject: string;
    date: string;
  }

  const sceneDefinitions: SceneDefinition[] = [
    {
      id: "today",
      name: "今日执行",
      description: "集中处理任务、速记与近期项目",
      icon: "✓",
      items: [
        { widgetId: "tasks.today", x: 0, y: 0, width: 8, height: 7 },
        { widgetId: "capture.memo", x: 8, y: 0, width: 4, height: 3 },
        { widgetId: "core.quick-create", x: 8, y: 3, width: 4, height: 2 },
        { widgetId: "projects.recent", x: 8, y: 5, width: 4, height: 3 }
      ]
    },
    {
      id: "projects",
      name: "项目管理",
      description: "查看项目、客户、任务与会议行动项",
      icon: "◆",
      items: [
        { widgetId: "projects.status", x: 0, y: 0, width: 4, height: 4 },
        { widgetId: "projects.milestones", x: 4, y: 0, width: 4, height: 4 },
        { widgetId: "tasks.project", x: 8, y: 0, width: 4, height: 4 },
        { widgetId: "clients.list", x: 0, y: 4, width: 6, height: 4 },
        { widgetId: "suppliers.list", x: 6, y: 4, width: 6, height: 4 },
        { widgetId: "meetings.actions", x: 0, y: 8, width: 12, height: 4 }
      ]
    },
    {
      id: "knowledge",
      name: "知识整理",
      description: "处理知识收件箱并建立项目关联",
      icon: "◇",
      items: [
        { widgetId: "knowledge.inbox", x: 0, y: 0, width: 4, height: 4 },
        { widgetId: "knowledge.triage", x: 4, y: 0, width: 4, height: 4 },
        { widgetId: "knowledge.project-links", x: 8, y: 0, width: 4, height: 4 },
        { widgetId: "knowledge.recent", x: 0, y: 4, width: 12, height: 4 }
      ]
    }
  ];

  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let activeScene: SceneId = (controller.settings.activeWorkbenchLayout as SceneId) || "today";
  let items: LayoutItem[] = loadScene(activeScene);
  let busy = false;
  let message = "";
  let dialog: DialogKind = null;
  let entityKind: Exclude<EntityKind, "knowledge"> = "project";
  let entityName = "";
  let relatedClient = "";
  let relatedProject = "";
  let entityDate = formatDate(new Date(), "YYYY-MM-DD");
  let entityTemplatePreview = "";
  let projectPath = "";
  let taskText = "";
  let taskDue = "";
  let taskPriority: TaskRecord["priority"] = "normal";
  let selectedTask: TaskRecord | undefined;
  let taskEditReason = "";
  let migrationTarget = "";
  let migrationTasks: TaskRecord[] = [];
  let selectedKnowledgePath = "";
  let knowledgeStatus = "待处理";
  let knowledgeProject = "";
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
  let showWidgetLibrary = false;
  let widgetLibrarySearch = "";
  let widgetLibraryPack: "all" | "view" | "control" | "capture" = "all";
  let selectedWidgetType = "";
  let editingWidget: LayoutItem | undefined;
  let editingConfig: Record<string, unknown> = {};
  let editingTitle = "";
  let sharedProjectPath = "";
  let widgetSearch: Record<string, string> = {};
  let isDesktop = !Platform.isMobile;
  let gridEl: HTMLDivElement;
  let unsubscribe = () => {};
  let drag:
    | {
        pointerId: number;
        instanceId: string;
        mode: MoveMode;
        startX: number;
        startY: number;
        original: LayoutItem;
      }
    | undefined;

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
    else if (layoutEditMode) layoutEditMode = false;
  }

  async function clearFocusFilters(item: LayoutItem): Promise<void> {
    await persistFocusFilters(item, structuredClone(DEFAULT_FOCUS_FILTERS));
  }

  function loadScene(sceneId: SceneId): LayoutItem[] {
    const saved = controller.settings.layouts.find(
      (layout) => layout.surface === "workbench" && layout.id === sceneId
    );
    const source = saved?.items ?? sceneDefinitions.find((scene) => scene.id === sceneId)?.items ?? [];
    return source.map((item) => ({ ...item, config: item.config ? structuredClone(item.config) : undefined }));
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
      "请协助我处理以下 Quiet Workbench 今日焦点。先分析和给出编号建议，不要直接修改文件：",
      ...rows.map((task, index) => `${index + 1}. [${scopeLabel(task.scope)}] ${task.text}（${focusDate(task)}，来源：${task.sourceName}）`)
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    await controller.openYolo();
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
      "请整理当前 Quiet Workbench 速记文件中今天尚未处理的分条记录。",
      "先在对话中分类并给出预览，不要直接修改文件：",
      "1. 可执行任务：说明建议归属的项目或客户、日期和优先级。",
      "2. 日记内容：整理成保留原意的简短段落。",
      "3. 知识素材或暂时保留的记录。",
      "等待我确认后再执行任何写入。"
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    await controller.openYolo(snapshot.memo.path);
  }

  function workbenchLayouts() {
    return controller.settings.layouts.filter((layout) => layout.surface === "workbench");
  }

  function sceneTitle(sceneId: string): string {
    return workbenchLayouts().find((layout) => layout.id === sceneId)?.name
      ?? sceneDefinitions.find((scene) => scene.id === sceneId)?.name
      ?? sceneId;
  }

  function sceneDescription(sceneId: string): string {
    return sceneDefinitions.find((scene) => scene.id === sceneId)?.description ?? "自定义工作台布局";
  }

  function sceneIcon(sceneId: string): string {
    return sceneDefinitions.find((scene) => scene.id === sceneId)?.icon ?? "▦";
  }

  function widgetLibraryItems() {
    const query = widgetLibrarySearch.trim().toLocaleLowerCase("zh-CN");
    return BUILTIN_WIDGETS
      .filter((widget) => widget.surfaces.includes("workbench"))
      .filter((widget) => widget.showInLibrary !== false)
      .filter((widget) => widgetLibraryPack === "all" || widget.libraryCategory === widgetLibraryPack)
      .filter((widget) => !query || `${widget.title} ${widget.description ?? ""} ${widget.id}`.toLocaleLowerCase("zh-CN").includes(query));
  }

  function widgetTypeIcon(id: string): string {
    return {
      "view.list": "☷",
      "view.board": "▥",
      "view.calendar": "▦",
      "view.quadrant": "⊞",
      "view.timeline": "↝",
      "view.metrics": "⌁",
      "view.detail": "▤",
      "view.relations": "⌘",
      "control.selector": "⌕",
      "control.actions": "⚡",
      "capture.memo": "✎"
    }[id] ?? "◇";
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
      config: preset
        ? structuredClone(preset.config) as unknown as Record<string, unknown>
        : defaultWidgetConfig(widgetId)
    };
    layoutUndo = [...layoutUndo.slice(-19), items.map((entry) => ({ ...entry }))];
    items = [...items, item];
    await controller.saveLayout(activeScene, items);
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
    layoutUndo = [...layoutUndo.slice(-19), items.map((entry) => ({ ...entry }))];
    items = items.filter((entry) => itemKey(entry) !== key);
    await controller.saveLayout(activeScene, items);
  }

  function openWidgetSettings(item: LayoutItem): void {
    editingWidget = item;
    editingTitle = widgetTitle(item);
    editingConfig = structuredClone(item.config ?? defaultWidgetConfig(item.widgetId) ?? {});
  }

  async function saveWidgetSettings(): Promise<void> {
    if (!editingWidget) return;
    const key = itemKey(editingWidget);
    items = items.map((item) => itemKey(item) === key ? { ...item, title: editingTitle.trim() || widgetTitle(item), config: structuredClone(editingConfig) } : item);
    await controller.saveLayout(activeScene, items);
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
    const section = ["scopeMode", "projectPath", "clientPath", "projectType", "taskScopes"].includes(key) ? "source" : "query";
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
    if (mode === "shared") return sharedProjectPath || contextProjectPath() || snapshot.projects[0]?.path || "";
    return "";
  }

  function projectForTask(task: TaskRecord) {
    if (task.scope === "project") return snapshot.projects.find((project) => project.path === task.path);
    if (task.scope === "meeting-draft") return resolveProject(snapshot.meetings.find((meeting) => meeting.path === task.path)?.project);
    return undefined;
  }

  function scopedProjects(item: LayoutItem) {
    const fixedPath = scopedProjectPath(item);
    const clientPath = configString(item, "clientPath");
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

  function scopedTasks(item: LayoutItem): TaskRecord[] {
    const projectPath = scopedProjectPath(item);
    const clientPath = configString(item, "clientPath");
    const projectType = configString(item, "projectType");
    const sourceTaskScopes = configSection(item.config ?? {}, "source").taskScopes;
    const taskScopes = Array.isArray(sourceTaskScopes) ? sourceTaskScopes.map(String) : Array.isArray(item.config?.taskScopes) ? item.config.taskScopes.map(String) : [];
    const query = (widgetSearch[itemKey(item)] ?? configString(item, "search")).trim().toLocaleLowerCase("zh-CN");
    return snapshot.tasks
      .filter((task) => !task.migrated)
      .filter((task) => configBoolean(item, "includeCompleted") || !task.completed)
      .filter((task) => !taskScopes.length || taskScopes.includes(task.scope))
      .filter((task) => !projectPath || projectForTask(task)?.path === projectPath)
      .filter((task) => !clientPath || taskClientPaths(task).includes(clientPath))
      .filter((task) => !projectType || projectForTask(task)?.projectType === projectType)
      .filter((task) => !query || `${task.text} ${task.sourceName}`.toLocaleLowerCase("zh-CN").includes(query))
      .slice(0, configLimit(item));
  }

  function selectedProject(item: LayoutItem) {
    return scopedProjects(item)[0] ?? snapshot.projects.find((project) => project.path === scopedProjectPath(item));
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

  function taskRowsForWidget(item: LayoutItem): TaskRecord[] {
    const rows = scopedTasks(item);
    const { today, end } = dayRange(7);
    const mode = queryMode(item);
    if (item.widgetId === "tasks.inbox" || mode === "inbox") return rows.filter((task) => !effectiveTaskDate(task) || task.scope !== "project");
    if (item.widgetId === "tasks.waiting" || item.widgetId === "projects.waiting" || mode === "waiting") return rows.filter(isWaitingTask);
    if (item.widgetId === "tasks.week" || mode === "week") return rows.filter((task) => {
      const date = effectiveTaskDate(task);
      return Boolean(date && date >= today && date <= end);
    });
    if (item.widgetId === "tasks.recurring" || mode === "recurring") return rows.filter(isRecurringTask);
    if (mode === "meeting-actions") return rows.filter((task) => task.scope === "meeting-draft");
    return rows;
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

  function sceneMetrics(sceneId: string): SceneMetric[] {
    const today = formatDate(new Date(), "YYYY-MM-DD");
    if (sceneId === "projects") {
      return [
        { label: "开放项目", value: snapshot.projects.length },
        { label: "有截止日期", value: snapshot.projects.filter((project) => project.due).length },
        { label: "会议草稿", value: snapshot.tasks.filter((task) => task.scope === "meeting-draft" && !task.completed).length }
      ];
    }
    if (sceneId === "knowledge") {
      return [
        { label: "待处理", value: snapshot.knowledge.filter((entry) => !entry.status || entry.status === "待处理").length },
        { label: "待沉淀/待读", value: snapshot.knowledge.filter((entry) => entry.status === "待沉淀" || entry.status === "待读").length },
        { label: "已关联项目", value: snapshot.knowledge.filter((entry) => entry.related).length }
      ];
    }
    return [
      { label: "逾期", value: snapshot.tasks.filter((task) => !task.completed && task.due && task.due < today).length },
      { label: "今天到期", value: snapshot.tasks.filter((task) => !task.completed && task.due === today).length },
      { label: "未来 7 天", value: calendarTasks().length }
    ];
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
    return { entity: "新建条目", task: "添加项目任务", "task-edit": "调整任务", migrate: "迁移会议行动项", knowledge: "处理知识" }[kind];
  }

  function entityTargetFolder(): string {
    return {
      project: controller.settings.projectFolder,
      client: controller.settings.clientFolder,
      meeting: controller.settings.meetingFolder,
      supplier: controller.settings.supplierFolder
    }[entityKind];
  }

  async function selectScene(sceneId: SceneId): Promise<void> {
    layoutEditMode = false;
    closeFocusFilters();
    activeScene = sceneId;
    items = loadScene(sceneId);
    hydrateFocusFilters();
    layoutUndo = [];
    await controller.activateLayout(sceneId);
  }

  function enabled(widgetId: string): boolean {
    const prefix = widgetId.split(".")[0];
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
    return [
      `grid-column: ${item.x + 1} / span ${item.width}`,
      `grid-row: ${item.y + 1} / span ${item.collapsed ? 1 : item.height}`
    ].join(";");
  }

  function beginPointer(event: PointerEvent, item: LayoutItem, mode: MoveMode): void {
    if (!isDesktop || !layoutEditMode) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      instanceId: itemKey(item),
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...item }
    };
  }

  function pointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId || !gridEl) return;
    const cellWidth = Math.max(gridEl.clientWidth / 12, 1);
    const cellHeight = 76;
    const dx = Math.round((event.clientX - drag.startX) / cellWidth);
    const dy = Math.round((event.clientY - drag.startY) / cellHeight);
    items = items.map((item) => {
      if (itemKey(item) !== drag?.instanceId) return item;
      const original = drag.original;
      if (drag.mode === "move") {
        return {
          ...item,
          x: Math.max(0, Math.min(12 - original.width, original.x + dx)),
          y: Math.max(0, original.y + dy)
        };
      }
      return {
        ...item,
        width: Math.max(3, Math.min(12 - original.x, original.width + dx)),
        height: Math.max(2, original.height + dy)
      };
    });
  }

  async function pointerUp(event: PointerEvent): Promise<void> {
    if (!drag || event.pointerId !== drag.pointerId) return;
    layoutUndo = [...layoutUndo.slice(-19), items.map((item) => itemKey(item) === drag?.instanceId ? { ...drag.original } : { ...item })];
    drag = undefined;
    await controller.saveLayout(activeScene, items);
  }

  async function setItemState(instanceId: string, patch: Partial<LayoutItem>): Promise<void> {
    layoutUndo = [...layoutUndo.slice(-19), items.map((item) => ({ ...item }))];
    items = items.map((item) => (itemKey(item) === instanceId ? { ...item, ...patch } : item));
    await controller.saveLayout(activeScene, items);
  }

  async function moveMobile(instanceId: string, offset: -1 | 1): Promise<void> {
    const index = items.findIndex((item) => itemKey(item) === instanceId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= items.length) return;
    layoutUndo = [...layoutUndo.slice(-19), items.map((item) => ({ ...item }))];
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    items = next;
    await controller.saveLayout(activeScene, items);
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

  function openCreate(kind: Exclude<EntityKind, "knowledge">, contextPath = ""): void {
    entityKind = kind;
    entityName = "";
    relatedClient = "";
    relatedProject = kind === "meeting" ? contextPath : "";
    entityTemplatePreview = "";
    entityStack = [];
    dialog = "entity";
  }

  function beginNestedEntity(kind: "client" | "project"): void {
    entityStack = [...entityStack, {
      kind: entityKind,
      name: entityName,
      relatedClient,
      relatedProject,
      date: entityDate
    }];
    entityKind = kind;
    entityName = "";
    relatedClient = "";
    relatedProject = "";
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

  function openTaskEdit(task: TaskRecord): void {
    selectedTask = task;
    taskDue = task.due ?? "";
    taskPriority = task.priority ?? "normal";
    taskEditReason = "";
    dialog = "task-edit";
  }

  function openMigration(task?: TaskRecord): void {
    selectedTask = task;
    migrationTasks = task ? [task] : tasksByScope("meeting-draft");
    migrationTarget = snapshot.projects[0]?.path ?? snapshot.clients[0]?.path ?? "";
    dialog = "migrate";
  }

  function openKnowledge(path: string, status?: string): void {
    selectedKnowledgePath = path;
    knowledgeStatus = status || "待处理";
    knowledgeProject = "";
    dialog = "knowledge";
  }

  async function undoLayout(): Promise<void> {
    const previous = layoutUndo.at(-1);
    if (!previous) return;
    layoutUndo = layoutUndo.slice(0, -1);
    items = previous.map((item) => ({ ...item }));
    await controller.saveLayout(activeScene, items);
  }

  async function copyLayout(): Promise<void> {
    const name = window.prompt("新布局名称", `${sceneTitle(activeScene)} 副本`);
    if (!name) return;
    activeScene = await controller.copyLayout(activeScene, name);
    items = loadScene(activeScene);
  }

  async function renameLayout(): Promise<void> {
    const name = window.prompt("布局名称", sceneTitle(activeScene));
    if (!name) return;
    await controller.renameLayout(activeScene, name);
    items = [...items];
  }

  async function restoreLayout(): Promise<void> {
    await controller.restoreLayout(activeScene);
    items = loadScene(activeScene);
    layoutUndo = [];
  }

  async function exportLayout(): Promise<void> {
    await navigator.clipboard.writeText(controller.exportLayout(activeScene));
    message = "布局 JSON 已复制到剪贴板";
  }

  async function importLayout(): Promise<void> {
    const payload = window.prompt("粘贴布局 JSON");
    if (!payload) return;
    activeScene = await controller.importLayout(payload);
    items = loadScene(activeScene);
  }

  async function submitEntity(): Promise<void> {
    const input: CreateEntityInput = {
      kind: entityKind,
      name: entityName.trim(),
      relatedClient: relatedClient || undefined,
      relatedProject: relatedProject || undefined,
      date: entityDate || undefined,
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
      entityTemplatePreview = "";
      message = `${childKind === "client" ? "客户" : "项目"}已创建，已返回原表单`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
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
    const succeeded = await run(
      () => migrationTasks.length === 1
        ? controller.migrateMeetingTask(migrationTasks[0], migrationTarget)
        : controller.migrateMeetingTasks(migrationTasks, migrationTarget),
      `已迁移 ${migrationTasks.length} 条会议行动项到「${targetName}」，可在任务看板查看`
    );
    if (succeeded) dialog = null;
  }

  async function submitKnowledge(): Promise<void> {
    if (!selectedKnowledgePath) return;
    const succeeded = await run(() => controller.updateKnowledge(selectedKnowledgePath, knowledgeStatus, knowledgeProject || undefined), "知识状态已更新");
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
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeydown);
    unsubscribe = controller.subscribe((next) => (snapshot = next));
    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeydown);
    };
  });

  onDestroy(() => unsubscribe());
</script>

<div class:layout-editing={layoutEditMode} class="qwb-shell" data-scene={activeScene}>
  <header class="qwb-header">
    <div>
      <div class="qwb-eyebrow">QUIET WORKBENCH · {UI_VERSION} · {activeScene.toUpperCase()}</div>
      <h1>{sceneTitle(activeScene)}</h1>
      <p>{sceneDescription(activeScene)}</p>
    </div>
    <div class="qwb-header-actions">
      <span class:enabled={controller.settings.writesEnabled} class="qwb-write-state">
        <span class="qwb-state-dot"></span>
        {controller.settings.writesEnabled ? "写入已启用" : "只读诊断"}
      </span>
      <button class="qwb-icon-button" aria-label="刷新工作台" title="刷新" disabled={busy} on:click={() => run(() => controller.refresh(), "已刷新")}>↻</button>
      <button class:active={layoutEditMode} class="qwb-button qwb-layout-mode-button" aria-pressed={layoutEditMode} on:click={() => (layoutEditMode = !layoutEditMode)}>{layoutEditMode ? "完成编辑" : "编辑布局"}</button>
      <button class="qwb-button qwb-button-subtle" on:click={() => controller.openTaskBoard()}>任务看板</button>
      <button class="qwb-button qwb-button-subtle" disabled={busy} on:click={() => run(() => controller.undoLastTransaction(), "已撤销最近一次操作")}>撤销</button>
    </div>
  </header>

  <nav class="qwb-scenes" aria-label="工作台场景">
    {#each workbenchLayouts() as scene}
      <button class:active={activeScene === scene.id} on:click={() => selectScene(scene.id)}><i>{sceneIcon(scene.id)}</i><span>{scene.name}</span></button>
    {/each}
  </nav>

  <section class="qwb-scene-summary" aria-label={`${sceneTitle(activeScene)}概览`}>
    <div class="qwb-scene-mark" aria-hidden="true">{sceneIcon(activeScene)}</div>
    {#each sceneMetrics(activeScene) as metric}
      <div class="qwb-scene-metric"><strong>{metric.value}</strong><span>{metric.label}</span></div>
    {/each}
  </section>

  {#if layoutEditMode}
    <div class="qwb-layout-actions" aria-label="布局操作">
      <span>布局编辑中</span>
      <button class="qwb-add-widget" disabled={busy} on:click={() => { selectedWidgetType = ""; showWidgetLibrary = true; }}>＋ 添加组件</button>
      <button disabled={!layoutUndo.length || busy} on:click={() => run(undoLayout, "已撤销布局调整")}>撤销布局</button>
      <button disabled={busy} on:click={() => run(copyLayout, "布局已复制")}>复制</button>
      <button disabled={busy} on:click={() => run(renameLayout, "布局已重命名")}>重命名</button>
      <button disabled={busy} on:click={() => run(restoreLayout, "已恢复默认布局")}>恢复默认</button>
      <button disabled={busy} on:click={() => run(exportLayout, "布局已导出")}>导出</button>
      <button disabled={busy} on:click={() => run(importLayout, "布局已导入")}>导入</button>
    </div>
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
    {#each items.filter((item) => !item.hidden && enabled(item.widgetId)) as item (itemKey(item))}
      <section class:collapsed={item.collapsed} class:editing={layoutEditMode} class="qwb-widget" style={itemStyle(item)}>
        <header class="qwb-widget-header">
          {#if layoutEditMode}
            <button class="qwb-drag-handle" aria-label={`移动${widgetTitle(item)}`} on:pointerdown={(event) => beginPointer(event, item, "move")}>
              <span aria-hidden="true">⠿</span>
            </button>
          {/if}
          <h2>{widgetTitle(item)}</h2>
          {#if layoutEditMode}
            <div class="qwb-widget-controls">
              {#if !isDesktop}
                <button aria-label="上移" on:click={() => moveMobile(itemKey(item), -1)}>↑</button>
                <button aria-label="下移" on:click={() => moveMobile(itemKey(item), 1)}>↓</button>
              {/if}
              <button aria-label="组件设置" title="组件设置" on:click={() => openWidgetSettings(item)}>⚙</button>
              <button aria-label={item.collapsed ? "展开" : "折叠"} on:click={() => setItemState(itemKey(item), { collapsed: !item.collapsed })}>{item.collapsed ? "＋" : "−"}</button>
              <button aria-label="隐藏" on:click={() => setItemState(itemKey(item), { hidden: true })}>×</button>
            </div>
          {/if}
        </header>

        {#if !item.collapsed}
          <div class="qwb-widget-body">
            {#if item.widgetId === "core.quick-create"}
              <div class="qwb-create-grid">
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
                    {#if task.scope === "meeting-draft"}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button>{:else}<button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button>{/if}
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
                  <div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || busy || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}<small>{scopeLabel(task.scope)} · {task.sourceName}</small></button><time>{effectiveTaskDate(task) ?? "未安排"}</time>{#if task.scope === "meeting-draft"}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button>{:else}<button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button>{/if}</div>
                {:else}<p class="qwb-empty">当前组件范围内没有任务。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openTask(scopedProjectPath(item))}>＋ 添加项目任务</button>
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
            {:else if item.widgetId === "tasks.calendar" || (item.widgetId === "view.calendar" && dataSource(item) === "tasks")}
              <div class="qwb-date-groups">
                {#each groupTasksByDate(item) as group}
                  <section><header><strong>{group[0]}</strong><span>{group[1].length}</span></header>{#each group[1] as task (task.id)}<button on:click={() => controller.openPath(task.path)}><span>{task.text}</span><small>{task.sourceName}</small></button>{/each}</section>
                {:else}<p class="qwb-empty">没有可显示的任务日期。</p>{/each}
              </div>
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
            {:else if item.widgetId === "tasks.timeline" || (item.widgetId === "view.timeline" && dataSource(item) === "tasks")}
              <div class="qwb-timeline">
                {#each groupTasksByDate(item).filter(([date]) => date !== "未安排") as group}<section><time>{group[0]}</time><div>{#each group[1] as task (task.id)}<button on:click={() => controller.openPath(task.path)}>{task.text}<small>{task.sourceName}</small></button>{/each}</div></section>{:else}<p class="qwb-empty">暂无带日期的任务。</p>{/each}
              </div>
            {:else if ["tasks.inbox", "tasks.waiting", "tasks.week", "tasks.recurring", "projects.waiting"].includes(item.widgetId)}
              <div class="qwb-task-list">
                {#each taskRowsForWidget(item) as task (task.id)}<div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}<small>{task.sourceName}</small></button><time>{effectiveTaskDate(task) ?? ""}</time>{#if task.scope === "meeting-draft"}<button class="qwb-row-action" on:click={() => openMigration(task)}>迁移</button>{/if}</div>{:else}<p class="qwb-empty">当前没有符合条件的任务。</p>{/each}
              </div>
            {:else if item.widgetId.startsWith("tasks.")}
              <div class="qwb-task-list">{#each scopedTasks(item) as task (task.id)}<div class="qwb-task-row"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || task.scope === "meeting-draft"} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} /><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}<small>{task.sourceName}</small></button><time>{effectiveTaskDate(task) ?? ""}</time><button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button></div>{:else}<p class="qwb-empty">暂无任务。</p>{/each}</div>
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
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索项目名称、客户或类型" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedProjects(item).length}</span></div>
              <div class="qwb-project-search-results">{#each scopedProjects(item).slice(0, 8) as project}<div class:active={sharedProjectPath === project.path}><button on:click={() => (sharedProjectPath = project.path)}><strong>{project.name}</strong><small>{project.client || project.projectType || project.status || "开放项目"}</small></button><button on:click={() => controller.openPath(project.path)}>打开</button></div>{:else}<p class="qwb-empty">没有匹配项目。</p>{/each}</div>
            {:else if item.widgetId === "projects.list" || (item.widgetId === "view.list" && dataSource(item) === "projects" && !["risks", "milestones"].includes(queryMode(item)))}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索项目" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{scopedProjects(item).length}</span></div>
              <div class="qwb-project-table">{#each projectRowsForWidget(item) as project}<button on:click={() => controller.openPath(project.path)}><span><strong>{project.name}</strong><small>{project.client || "未关联客户"}</small></span><em>{project.projectType || "未分类"}</em><em>{project.status || project.phase || "开放"}</em><time>{project.due || ""}</time></button>{:else}<p class="qwb-empty">没有匹配项目。</p>{/each}</div>
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
              {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}
                <div class="qwb-project-summary"><button class="qwb-summary-title" on:click={() => controller.openPath(project.path)}><span class="qwb-entity-icon project">P</span><span><strong>{project.name}</strong><small>{project.client || "未关联客户"}</small></span></button><dl><div><dt>类型</dt><dd>{project.projectType || "未设置"}</dd></div><div><dt>状态</dt><dd>{project.status || "开放"}</dd></div><div><dt>阶段</dt><dd>{project.phase || "未设置"}</dd></div><div><dt>目标日期</dt><dd>{project.due || "未设置"}</dd></div></dl><p>{project.detail || "尚未填写明确下一步。"}</p><div class="qwb-summary-actions"><button on:click={() => (sharedProjectPath = project.path)}>设为共享项目</button><button on:click={() => controller.openYolo(project.path)}>YOLO</button></div></div>
              {:else}<p class="qwb-empty">请选择或配置一个项目。</p>{/each}
            {:else if item.widgetId === "projects.health" || (item.widgetId === "view.metrics" && metricKind(item) === "health")}
              <div class="qwb-health-list">{#each scopedProjects(item) as project}<button on:click={() => controller.openPath(project.path)}><i class={projectHealth(project).level}></i><span><strong>{project.name}</strong><small>{projectHealth(project).reasons.join(" · ") || "没有发现风险信号"}</small></span><em>{healthLabel(projectHealth(project).level)}</em></button>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}</div>
            {:else if item.widgetId === "projects.progress" || (item.widgetId === "view.metrics" && metricKind(item) === "progress")}
              <div class="qwb-progress-list">{#each scopedProjects(item) as project}<button on:click={() => controller.openPath(project.path)}><span><strong>{project.name}</strong><small>{projectHealth(project).completed} 已完成 · {projectHealth(project).open} 待处理 · {projectHealth(project).overdue} 逾期</small></span><div><i style={`width:${projectHealth(project).progress}%`}></i></div><em>{projectHealth(project).progress}%</em></button>{:else}<p class="qwb-empty">暂无进度数据。</p>{/each}</div>
            {:else if item.widgetId === "projects.meetings" || (item.widgetId === "view.list" && dataSource(item) === "meetings")}
              {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}<p class="qwb-widget-hint">{project.name}的相关会议</p><div class="qwb-entity-list compact">{#each meetingsForProject(project.path) as meeting}<button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.due || meeting.status || "会议记录"}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无关联会议。</p>{/each}</div><button class="qwb-text-action" on:click={() => openCreate("meeting", project.path)}>＋ 创建会议</button>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}
            {:else if item.widgetId === "projects.actions" || (item.widgetId === "view.list" && queryMode(item) === "meeting-actions")}
              <div class="qwb-task-list">{#each scopedTasks(item).filter((task) => task.scope === "meeting-draft") as task (task.id)}<div class="qwb-task-row"><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}<small>{task.sourceName}</small></button><time>{task.due || ""}</time><button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button></div>{:else}<p class="qwb-empty">没有待迁移的会议行动。</p>{/each}</div>
            {:else if item.widgetId === "projects.risks" || (item.widgetId === "view.list" && dataSource(item) === "projects" && queryMode(item) === "risks")}
              <div class="qwb-risk-list">{#each scopedProjects(item).filter((project) => projectHealth(project).level !== "healthy") as project}<button on:click={() => controller.openPath(project.path)}><strong>{project.name}</strong><span>{#each projectHealth(project).reasons as reason}<small>{reason}</small>{:else}<small>项目信息不足，暂时无法判断。</small>{/each}</span><em class={projectHealth(project).level}>{healthLabel(projectHealth(project).level)}</em></button>{:else}<p class="qwb-empty">当前没有识别到项目风险。</p>{/each}</div>
            {:else if item.widgetId === "projects.activity" || (item.widgetId === "view.timeline" && queryMode(item) === "project-activity")}
              <div class="qwb-activity-list">{#each [...scopedProjects(item).map((project) => ({ ...project, activityType: "项目" })), ...snapshot.meetings.map((meeting) => ({ ...meeting, activityType: "会议" }))].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)).slice(0, configLimit(item)) as entry}<button on:click={() => controller.openPath(entry.path)}><time>{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString("zh-CN") : ""}</time><span><strong>{entry.name}</strong><small>{entry.activityType} · {entry.detail || entry.status || "最近修改"}</small></span></button>{:else}<p class="qwb-empty">暂无最近动态。</p>{/each}</div>
            {:else if item.widgetId === "projects.relations" || item.widgetId === "view.relations"}
              {#each selectedProject(item) ? [selectedProject(item)!] : [] as project}<div class="qwb-relations"><section><strong>客户</strong>{#each resolveEntityReference(project.client, snapshot.clients) ? [resolveEntityReference(project.client, snapshot.clients)!] : [] as client}<button on:click={() => controller.openPath(client.path)}>{client.name}</button>{:else}<span>未关联</span>{/each}</section><section><strong>会议</strong>{#each meetingsForProject(project.path).slice(0, 6) as meeting}<button on:click={() => controller.openPath(meeting.path)}>{meeting.name}</button>{:else}<span>暂无</span>{/each}</section><section><strong>知识</strong>{#each relatedKnowledge(project.path).slice(0, 6) as note}<button on:click={() => controller.openPath(note.path)}>{note.name}</button>{:else}<span>暂无</span>{/each}</section></div>{:else}<p class="qwb-empty">请选择或配置项目。</p>{/each}
            {:else if item.widgetId === "projects.quick-actions" || item.widgetId === "control.actions"}
              <div class="qwb-create-grid"><button on:click={() => openCreate("project")}><span>＋</span>新建项目</button><button on:click={() => openTask(scopedProjectPath(item))}><span>＋</span>项目任务</button><button on:click={() => openCreate("meeting", scopedProjectPath(item))}><span>＋</span>项目会议</button><button disabled={!selectedProject(item)} on:click={() => selectedProject(item) && controller.openPath(selectedProject(item)!.path)}><span>↗</span>打开项目</button></div><button class="qwb-button qwb-button-primary qwb-full" disabled={!selectedProject(item)} on:click={() => selectedProject(item) && controller.openYolo(selectedProject(item)!.path)}>用当前项目打开 YOLO</button>
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
                {#each tasksByScope("meeting-draft").slice(0, 6) as task}<div class="qwb-task-row"><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}</button>{#if task.due}<time>{task.due}</time>{/if}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button></div>{/each}
              </div>
              <div class="qwb-entity-list compact">
                {#each snapshot.meetings.slice(0, 8) as meeting}
                  <button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.related || "会议记录"}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">暂无会议记录。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("meeting")}>＋ 新建会议</button>
            {:else if item.widgetId === "view.list" && dataSource(item) === "clients"}
              <div class="qwb-widget-search"><input value={widgetSearch[itemKey(item)] ?? ""} placeholder="搜索客户" on:input={(event) => (widgetSearch = { ...widgetSearch, [itemKey(item)]: (event.currentTarget as HTMLInputElement).value })} /><span>{snapshot.clients.length}</span></div>
              <div class="qwb-entity-list compact">{#each snapshot.clients.filter((client) => !widgetSearch[itemKey(item)] || `${client.name} ${client.path} ${client.aliases.join(" ")}`.toLocaleLowerCase("zh-CN").includes(widgetSearch[itemKey(item)].toLocaleLowerCase("zh-CN"))).slice(0, configLimit(item)) as client}<button on:click={() => controller.openPath(client.path)}><span class="qwb-entity-icon client">C</span><span><strong>{client.name}</strong><small>{client.status || "客户"}</small></span><i>›</i></button>{:else}<p class="qwb-empty">暂无匹配客户。</p>{/each}</div>
              <button class="qwb-text-action" on:click={() => openCreate("client")}>＋ 新建客户</button>
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
          {#if isDesktop && layoutEditMode}
            <button use:obsidianIcon={"scaling"} class="qwb-resize-handle" aria-label={`调整${widgetTitle(item)}大小`} title="拖动调整大小" on:pointerdown={(event) => beginPointer(event, item, "resize")}></button>
          {/if}
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
      {#if !selectedWidgetType}
        <input class="qwb-library-search" bind:value={widgetLibrarySearch} placeholder="搜索列表、看板、日历等组件类型" />
        <nav class="qwb-library-packs"><button class:active={widgetLibraryPack === "all"} on:click={() => (widgetLibraryPack = "all")}>全部</button><button class:active={widgetLibraryPack === "view"} on:click={() => (widgetLibraryPack = "view")}>视图</button><button class:active={widgetLibraryPack === "control"} on:click={() => (widgetLibraryPack = "control")}>控制</button><button class:active={widgetLibraryPack === "capture"} on:click={() => (widgetLibraryPack = "capture")}>记录</button></nav>
        <div class="qwb-library-grid qwb-library-types">
          {#each widgetLibraryItems() as widget (widget.id)}
            <button on:click={() => (selectedWidgetType = widget.id)}><i>{widgetTypeIcon(widget.id)}</i><span><strong>{widget.title}</strong><small>{widget.description || widget.id}</small></span><em>{widget.defaultSize.width}×{widget.defaultSize.height}</em></button>
          {:else}<p class="qwb-empty">没有匹配组件类型。</p>{/each}
        </div>
      {:else}
        <button class="qwb-library-back" on:click={() => (selectedWidgetType = "")}>← 返回组件类型</button>
        <div class="qwb-library-grid qwb-library-presets">
          <button on:click={() => run(() => addWidget(selectedWidgetType), "已添加空白组件")}><i>{widgetTypeIcon(selectedWidgetType)}</i><span><strong>空白组件</strong><small>从默认数据源开始，自行配置名称和筛选。</small></span><em>自定义</em></button>
          {#each presetsForType(selectedWidgetType) as preset (preset.id)}
            <button on:click={() => run(() => addWidget(selectedWidgetType, preset.id), `已添加「${preset.title}」`)}><i>{widgetTypeIcon(selectedWidgetType)}</i><span><strong>{preset.title}</strong><small>{preset.description}</small></span><em>预设</em></button>
          {/each}
        </div>
      {/if}
      <p class="qwb-library-note">同一种组件可以重复添加；每个实例的筛选、数据范围和尺寸分别保存。</p>
    </div>
  </div>
{/if}

{#if editingWidget}
  <div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (editingWidget = undefined)}>
    <div class="qwb-modal qwb-widget-settings" role="dialog" aria-modal="true" aria-labelledby="qwb-widget-settings-title">
      <header><div><span class="qwb-eyebrow">WIDGET INSTANCE</span><h2 id="qwb-widget-settings-title">{widgetTitle(editingWidget)}设置</h2></div><button aria-label="关闭" on:click={() => (editingWidget = undefined)}>×</button></header>
      <label>组件名称<input bind:value={editingTitle} placeholder="例如：客户 A 待跟进" /></label>
      {#if editingWidget.widgetId.startsWith("view.") || editingWidget.widgetId.startsWith("control.") || editingWidget.widgetId.startsWith("tasks.") || editingWidget.widgetId.startsWith("projects.")}
        <label>数据源<select value={String(configSection(editingConfig, "source").kind ?? (editingWidget.widgetId.startsWith("projects.") ? "projects" : "tasks"))} on:change={(event) => updateEditingSource({ kind: (event.currentTarget as HTMLSelectElement).value })}><option value="tasks">任务</option><option value="projects">项目</option><option value="clients">客户</option><option value="meetings">会议</option><option value="knowledge">知识</option><option value="mixed">混合</option></select></label>
        <label>数据范围<select value={String(configSection(editingConfig, "source").scopeMode ?? editingConfig.scopeMode ?? "all")} on:change={(event) => updateEditingSource({ scopeMode: (event.currentTarget as HTMLSelectElement).value })}><option value="all">全部数据</option><option value="shared">跟随共享项目</option><option value="context">跟随当前笔记</option><option value="fixed">固定项目</option></select></label>
        {#if (configSection(editingConfig, "source").scopeMode ?? editingConfig.scopeMode) === "fixed"}<label>固定项目<select value={String(configSection(editingConfig, "source").projectPath ?? editingConfig.projectPath ?? "")} on:change={(event) => updateEditingSource({ projectPath: (event.currentTarget as HTMLSelectElement).value })}><option value="">选择项目</option>{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</select></label>{/if}
        <label>客户筛选<select value={String(configSection(editingConfig, "source").clientPath ?? editingConfig.clientPath ?? "")} on:change={(event) => updateEditingSource({ clientPath: (event.currentTarget as HTMLSelectElement).value })}><option value="">全部客户</option>{#each snapshot.clients as client}<option value={client.path}>{client.name}</option>{/each}</select></label>
        <label>项目类型<select value={String(configSection(editingConfig, "source").projectType ?? editingConfig.projectType ?? "")} on:change={(event) => updateEditingSource({ projectType: (event.currentTarget as HTMLSelectElement).value })}><option value="">全部类型</option>{#each focusProjectTypes() as projectType}<option value={projectType}>{projectType}</option>{/each}</select></label>
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
{/if}

{#if dialog}
  <div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (dialog = null)}>
    <div class="qwb-modal" role="dialog" aria-modal="true" aria-labelledby="qwb-dialog-title">
      <header><div><span class="qwb-eyebrow">SAFE WORKFLOW</span><h2 id="qwb-dialog-title">{dialogTitle(dialog)}</h2></div><button aria-label="关闭" on:click={() => (dialog = null)}>×</button></header>
      {#if !controller.settings.writesEnabled}
        <div class="qwb-inline-warning">写入尚未启用。请先在插件设置中阅读说明并确认。</div>
      {/if}
      {#if dialog === "entity"}
        <label>类型<select bind:value={entityKind}><option value="project">项目</option><option value="client">客户</option><option value="meeting">会议</option><option value="supplier">供应商</option></select></label>
        <label>名称<input bind:value={entityName} placeholder="输入清晰、可检索的名称" /></label>
        {#if entityKind === "project"}<label>关联客户<select bind:value={relatedClient}><option value="">暂不关联</option>{#each snapshot.clients as client}<option value={client.path}>{client.name}</option>{/each}</select></label><button class="qwb-text-action" type="button" on:click={() => beginNestedEntity("client")}>＋ 没有客户？先创建客户</button>{/if}
        {#if entityKind === "meeting"}<label>关联项目<select bind:value={relatedProject}><option value="">暂不关联</option>{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</select></label><button class="qwb-text-action" type="button" on:click={() => beginNestedEntity("project")}>＋ 没有项目？先创建项目</button><label>日期<input type="date" bind:value={entityDate} /></label>{/if}
        <div class="qwb-inline-preview"><strong>写入预览</strong><div>{entityTargetFolder()}/{entityKind === "meeting" && entityDate ? `${entityDate} ` : ""}{entityName || "未命名"}.md</div><small>确认后仍会执行模板、重名与路径预检。</small></div>
        <button class="qwb-text-action" type="button" disabled={!entityName.trim() || busy} on:click={() => run(previewEntityTemplate, "模板预览已生成")}>生成完整模板预览</button>
        {#if entityTemplatePreview}<pre class="qwb-template-preview">{entityTemplatePreview}</pre>{/if}
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !entityName.trim() || busy} on:click={submitEntity}>确认创建</button></div>
      {:else if dialog === "task"}
        <label>项目<select bind:value={projectPath}><option value="">选择项目</option>{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</select></label>
        <label>任务<textarea bind:value={taskText} rows="3" placeholder="描述下一步具体行动"></textarea></label>
        <div class="qwb-form-row"><label>截止日期<input type="date" bind:value={taskDue} /></label><label>优先级<select bind:value={taskPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label></div>
        <div class="qwb-inline-preview"><strong>写入预览</strong><div>{taskText || "未填写任务"}{taskDue ? ` · 截止 ${taskDue}` : ""}</div><small>{projectPath || "尚未选择项目"}</small></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !projectPath || !taskText.trim() || busy} on:click={submitTask}>添加任务</button></div>
      {:else if dialog === "task-edit"}
        {#if taskEditReason}<div class="qwb-inline-warning">{taskEditReason}</div>{/if}
        <p>{selectedTask?.text}</p>
        <div class="qwb-form-row"><label>截止日期<input type="date" bind:value={taskDue} /></label><label>优先级<select bind:value={taskPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || busy} on:click={submitTaskEdit}>保存</button></div>
      {:else if dialog === "migrate"}
        <p>预览：将 {migrationTasks.length} 条会议草稿迁移到同一目标项目。成功项会标记完成并写入稳定来源标记；失败时保留回执，可修复后重试。</p>
        <div class="qwb-inline-preview">{#each migrationTasks.slice(0, 8) as task}<div>• {task.text} <small>{task.sourceName}</small></div>{/each}</div>
        <label>迁移目标<select bind:value={migrationTarget}><option value="">选择项目或客户</option><optgroup label="项目">{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</optgroup><optgroup label="客户">{#each snapshot.clients as client}<option value={client.path}>{client.name}</option>{/each}</optgroup></select></label>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !migrationTarget || busy} on:click={submitMigration}>预检并迁移</button></div>
      {:else if dialog === "knowledge"}
        <label>处理状态<select bind:value={knowledgeStatus}><option>待处理</option><option>待沉淀</option><option>待读</option><option>已归档</option><option>重复</option></select></label>
        <label>关联项目<select bind:value={knowledgeProject}><option value="">暂不关联</option>{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</select></label>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || busy} on:click={submitKnowledge}>保存处理结果</button></div>
      {/if}
    </div>
  </div>
{/if}
