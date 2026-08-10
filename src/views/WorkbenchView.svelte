<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Platform } from "obsidian";
  import type { EntityKind, LayoutItem, TaskRecord } from "../core/types";
  import type {
    AddProjectTaskInput,
    CreateEntityInput,
    WorkbenchController,
    WorkbenchSnapshot
  } from "../ui/controller";
  import { EMPTY_SNAPSHOT } from "../ui/controller";

  export let controller: WorkbenchController;

  type SceneId = string;
  type DialogKind = "entity" | "task" | "task-edit" | "migrate" | "knowledge" | null;
  type MoveMode = "move" | "resize";

  interface SceneDefinition {
    id: SceneId;
    name: string;
    description: string;
    items: LayoutItem[];
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
      description: "集中处理任务、日程与近期项目",
      items: [
        { widgetId: "core.quick-create", x: 0, y: 0, width: 4, height: 2 },
        { widgetId: "tasks.today", x: 4, y: 0, width: 8, height: 5 },
        { widgetId: "core.calendar", x: 0, y: 2, width: 4, height: 3 },
        { widgetId: "projects.recent", x: 0, y: 5, width: 7, height: 4 },
        { widgetId: "meetings.actions", x: 7, y: 5, width: 5, height: 4 }
      ]
    },
    {
      id: "projects",
      name: "项目管理",
      description: "查看项目、客户、任务与会议行动项",
      items: [
        { widgetId: "projects.status", x: 0, y: 0, width: 7, height: 5 },
        { widgetId: "tasks.project", x: 7, y: 0, width: 5, height: 5 },
        { widgetId: "meetings.actions", x: 0, y: 5, width: 4, height: 4 },
        { widgetId: "clients.list", x: 4, y: 5, width: 4, height: 4 },
        { widgetId: "suppliers.list", x: 8, y: 5, width: 4, height: 4 }
      ]
    },
    {
      id: "knowledge",
      name: "知识整理",
      description: "处理知识收件箱并建立项目关联",
      items: [
        { widgetId: "knowledge.inbox", x: 0, y: 0, width: 8, height: 6 },
        { widgetId: "projects.recent", x: 8, y: 0, width: 4, height: 3 },
        { widgetId: "tasks.today", x: 8, y: 3, width: 4, height: 3 },
        { widgetId: "core.diagnostics", x: 0, y: 6, width: 12, height: 2, collapsed: true }
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
  let entityDate = new Date().toISOString().slice(0, 10);
  let projectPath = "";
  let taskText = "";
  let taskDue = "";
  let taskPriority: TaskRecord["priority"] = "normal";
  let selectedTask: TaskRecord | undefined;
  let migrationTarget = "";
  let migrationTasks: TaskRecord[] = [];
  let selectedKnowledgePath = "";
  let knowledgeStatus = "待处理";
  let knowledgeProject = "";
  let entityStack: EntityDraft[] = [];
  let layoutUndo: LayoutItem[][] = [];
  let isDesktop = !Platform.isMobile;
  let gridEl: HTMLDivElement;
  let unsubscribe = () => {};
  let drag:
    | {
        pointerId: number;
        widgetId: string;
        mode: MoveMode;
        startX: number;
        startY: number;
        original: LayoutItem;
      }
    | undefined;

  const widgetTitles: Record<string, string> = {
    "core.quick-create": "快捷创建",
    "tasks.today": "今日任务",
    "tasks.project": "项目任务",
    "core.calendar": "日程",
    "projects.recent": "开放项目",
    "projects.status": "项目状态",
    "meetings.actions": "会议与行动项",
    "clients.list": "客户",
    "suppliers.list": "供应商",
    "knowledge.inbox": "知识收件箱",
    "core.diagnostics": "诊断"
  };

  function loadScene(sceneId: SceneId): LayoutItem[] {
    const saved = controller.settings.layouts.find(
      (layout) => layout.surface === "workbench" && layout.id === sceneId
    );
    const source = saved?.items ?? sceneDefinitions.find((scene) => scene.id === sceneId)?.items ?? [];
    return source.map((item) => ({ ...item }));
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
    activeScene = sceneId;
    items = loadScene(sceneId);
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

  function visibleItems(): LayoutItem[] {
    return items.filter((item) => !item.hidden && enabled(item.widgetId));
  }

  function hiddenItems(): LayoutItem[] {
    return items.filter((item) => item.hidden);
  }

  function itemStyle(item: LayoutItem): string {
    if (!isDesktop) return "";
    return [
      `grid-column: ${item.x + 1} / span ${item.width}`,
      `grid-row: ${item.y + 1} / span ${item.collapsed ? 1 : item.height}`
    ].join(";");
  }

  function beginPointer(event: PointerEvent, item: LayoutItem, mode: MoveMode): void {
    if (!isDesktop) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      widgetId: item.widgetId,
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
      if (item.widgetId !== drag?.widgetId) return item;
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
    layoutUndo = [...layoutUndo.slice(-19), items.map((item) => item.widgetId === drag?.widgetId ? { ...drag.original } : { ...item })];
    drag = undefined;
    await controller.saveLayout(activeScene, items);
  }

  async function setItemState(widgetId: string, patch: Partial<LayoutItem>): Promise<void> {
    layoutUndo = [...layoutUndo.slice(-19), items.map((item) => ({ ...item }))];
    items = items.map((item) => (item.widgetId === widgetId ? { ...item, ...patch } : item));
    await controller.saveLayout(activeScene, items);
  }

  async function moveMobile(widgetId: string, offset: -1 | 1): Promise<void> {
    const index = items.findIndex((item) => item.widgetId === widgetId);
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

  function openCreate(kind: Exclude<EntityKind, "knowledge">): void {
    entityKind = kind;
    entityName = "";
    relatedClient = "";
    relatedProject = "";
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
  }

  function openTask(path?: string): void {
    projectPath = path || snapshot.projects[0]?.path || "";
    taskText = "";
    taskDue = "";
    taskPriority = "normal";
    dialog = "task";
  }

  function openTaskEdit(task: TaskRecord): void {
    selectedTask = task;
    taskDue = task.due ?? "";
    taskPriority = task.priority ?? "normal";
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
    const succeeded = await run(() => controller.addProjectTask(input), "项目任务已添加");
    if (succeeded) dialog = null;
  }

  async function submitTaskEdit(): Promise<void> {
    if (!selectedTask) return;
    const succeeded = await run(() => controller.updateTask(selectedTask!, { due: taskDue || null, priority: taskPriority }), "任务已更新");
    if (succeeded) dialog = null;
  }

  async function submitMigration(): Promise<void> {
    if (!migrationTasks.length || !migrationTarget) return;
    const succeeded = await run(
      () => migrationTasks.length === 1
        ? controller.migrateMeetingTask(migrationTasks[0], migrationTarget)
        : controller.migrateMeetingTasks(migrationTasks, migrationTarget),
      `已处理 ${migrationTasks.length} 条会议行动项`
    );
    if (succeeded) dialog = null;
  }

  async function submitKnowledge(): Promise<void> {
    if (!selectedKnowledgePath) return;
    const succeeded = await run(() => controller.updateKnowledge(selectedKnowledgePath, knowledgeStatus, knowledgeProject || undefined), "知识状态已更新");
    if (succeeded) dialog = null;
  }

  function tasksByScope(scope: TaskRecord["scope"]): TaskRecord[] {
    return snapshot.tasks.filter((task) => task.scope === scope && !task.completed).slice(0, 8);
  }

  onMount(() => {
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    unsubscribe = controller.subscribe((next) => (snapshot = next));
    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
    };
  });

  onDestroy(() => unsubscribe());
</script>

<div class="qwb-shell">
  <header class="qwb-header">
    <div>
      <div class="qwb-eyebrow">QUIET WORKBENCH</div>
      <h1>{sceneTitle(activeScene)}</h1>
      <p>{sceneDescription(activeScene)}</p>
    </div>
    <div class="qwb-header-actions">
      <span class:enabled={controller.settings.writesEnabled} class="qwb-write-state">
        <span class="qwb-state-dot"></span>
        {controller.settings.writesEnabled ? "写入已启用" : "只读诊断"}
      </span>
      <button class="qwb-icon-button" aria-label="刷新工作台" title="刷新" disabled={busy} on:click={() => run(() => controller.refresh(), "已刷新")}>↻</button>
      <button class="qwb-button qwb-button-subtle" disabled={busy} on:click={() => run(() => controller.undoLastTransaction(), "已撤销最近一次操作")}>撤销</button>
    </div>
  </header>

  <nav class="qwb-scenes" aria-label="工作台场景">
    {#each workbenchLayouts() as scene}
      <button class:active={activeScene === scene.id} on:click={() => selectScene(scene.id)}>{scene.name}</button>
    {/each}
  </nav>

  <div class="qwb-layout-actions" aria-label="布局操作">
    <button disabled={!layoutUndo.length || busy} on:click={() => run(undoLayout, "已撤销布局调整")}>撤销布局</button>
    <button disabled={busy} on:click={() => run(copyLayout, "布局已复制")}>复制</button>
    <button disabled={busy} on:click={() => run(renameLayout, "布局已重命名")}>重命名</button>
    <button disabled={busy} on:click={() => run(restoreLayout, "已恢复默认布局")}>恢复默认</button>
    <button disabled={busy} on:click={() => run(exportLayout, "布局已导出")}>导出</button>
    <button disabled={busy} on:click={() => run(importLayout, "布局已导入")}>导入</button>
  </div>

  {#if !controller.settings.writesEnabled}
    <div class="qwb-safety-banner">
      <div><strong>当前为只读模式</strong><span>可以浏览和运行诊断；在设置中确认后才会开放写入。</span></div>
      <button on:click={() => controller.refresh()}>重新诊断</button>
    </div>
  {/if}

  {#if message}
    <div class="qwb-toast" role="status">{message}</div>
  {/if}

  <div class="qwb-grid" bind:this={gridEl}>
    {#each visibleItems() as item (item.widgetId)}
      <section class:collapsed={item.collapsed} class="qwb-widget" style={itemStyle(item)}>
        <header class="qwb-widget-header">
          <button class="qwb-drag-handle" aria-label={`移动${widgetTitles[item.widgetId]}`} on:pointerdown={(event) => beginPointer(event, item, "move")}>
            <span aria-hidden="true">⠿</span>
          </button>
          <h2>{widgetTitles[item.widgetId]}</h2>
          <div class="qwb-widget-controls">
            {#if !isDesktop}
              <button aria-label="上移" on:click={() => moveMobile(item.widgetId, -1)}>↑</button>
              <button aria-label="下移" on:click={() => moveMobile(item.widgetId, 1)}>↓</button>
            {/if}
            <button aria-label={item.collapsed ? "展开" : "折叠"} on:click={() => setItemState(item.widgetId, { collapsed: !item.collapsed })}>{item.collapsed ? "＋" : "−"}</button>
            <button aria-label="隐藏" on:click={() => setItemState(item.widgetId, { hidden: true })}>×</button>
          </div>
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
            {:else if item.widgetId.startsWith("tasks.")}
              <div class="qwb-scope-section">
                <div class="qwb-section-title"><span class="qwb-scope project">项目</span><strong>{tasksByScope("project").length}</strong></div>
                {#each tasksByScope("project") as task (task.id)}
                  <div class="qwb-task-row">
                    <input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || busy} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "任务状态已更新")} />
                    <button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}</button>
                    {#if task.due}<time>{task.due}</time>{/if}
                    <button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button>
                  </div>
                {/each}
              </div>
              <div class="qwb-scope-section">
                <div class="qwb-section-title"><span class="qwb-scope client">客户行动</span><strong>{tasksByScope("client").length}</strong></div>
                {#each tasksByScope("client").slice(0, 4) as task (task.id)}
                  <div class="qwb-task-row"><input type="checkbox" disabled={!controller.settings.writesEnabled || busy} on:change={(event) => run(() => controller.updateTask(task, { completed: (event.currentTarget as HTMLInputElement).checked }), "客户行动已更新")} /><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}</button>{#if task.due}<time>{task.due}</time>{/if}<button class="qwb-row-action" on:click={() => openTaskEdit(task)}>编辑</button></div>
                {/each}
              </div>
              <div class="qwb-scope-section">
                <div class="qwb-section-title"><span class="qwb-scope meeting">会议草稿</span><strong>{tasksByScope("meeting-draft").length}</strong></div>
                {#each tasksByScope("meeting-draft").slice(0, 4) as task (task.id)}
                  <div class="qwb-task-row"><button class="qwb-link" on:click={() => controller.openPath(task.path)}>{task.text}</button>{#if task.due}<time>{task.due}</time>{/if}<button class="qwb-row-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration(task)}>迁移</button></div>
                {/each}
                {#if tasksByScope("meeting-draft").length > 1}<button class="qwb-text-action" disabled={!controller.settings.writesEnabled} on:click={() => openMigration()}>批量迁移全部会议草稿</button>{/if}
              </div>
              <button class="qwb-text-action" on:click={() => openTask()}>＋ 添加项目任务</button>
            {:else if item.widgetId === "core.calendar"}
              <div class="qwb-calendar-date"><strong>{new Date().getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", weekday: "long" }).format(new Date())}</span></div>
              <div class="qwb-calendar-lines">
                {#each snapshot.tasks.filter((task) => task.due).slice(0, 4) as task}
                  <button on:click={() => controller.openPath(task.path)}><time>{task.due}</time><span>{task.text}</span></button>
                {:else}
                  <p class="qwb-empty">今天没有已标记日期的任务。</p>
                {/each}
              </div>
            {:else if item.widgetId.startsWith("projects.")}
              <div class="qwb-entity-list">
                {#each snapshot.projects.slice(0, 12) as project}
                  <button on:click={() => controller.openPath(project.path)}>
                    <span class="qwb-entity-icon project">P</span><span><strong>{project.name}</strong><small>{project.status || "开放项目"}</small></span>
                    <i>›</i>
                  </button>
                {:else}
                  <p class="qwb-empty">未发现开放项目。请先检查项目目录配置。</p>
                {/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("project")}>＋ 新建项目</button>
            {:else if item.widgetId.startsWith("meetings.")}
              <div class="qwb-entity-list compact">
                {#each snapshot.meetings.slice(0, 8) as meeting}
                  <button on:click={() => controller.openPath(meeting.path)}><span class="qwb-entity-icon meeting">M</span><span><strong>{meeting.name}</strong><small>{meeting.related || "会议记录"}</small></span><i>›</i></button>
                {:else}<p class="qwb-empty">暂无会议记录。</p>{/each}
              </div>
              <button class="qwb-text-action" on:click={() => openCreate("meeting")}>＋ 新建会议</button>
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
              <div class="qwb-knowledge-summary">
                {#each ["待处理", "待沉淀", "待读", "已归档", "重复"] as status}
                  <div><strong>{snapshot.knowledge.filter((entry) => entry.status === status).length}</strong><span>{status}</span></div>
                {/each}
              </div>
              <div class="qwb-entity-list">
                {#each snapshot.knowledge.filter((entry) => entry.status !== "已归档").slice(0, 10) as entry}
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
          {#if isDesktop}
            <button class="qwb-resize-handle" aria-label={`调整${widgetTitles[item.widgetId]}大小`} on:pointerdown={(event) => beginPointer(event, item, "resize")}></button>
          {/if}
        {/if}
      </section>
    {/each}
  </div>

  {#if hiddenItems().length}
    <footer class="qwb-hidden-widgets">
      <span>已隐藏</span>
      {#each hiddenItems() as item}
        <button on:click={() => setItemState(item.widgetId, { hidden: false })}>＋ {widgetTitles[item.widgetId]}</button>
      {/each}
    </footer>
  {/if}
</div>

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
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !entityName.trim() || busy} on:click={submitEntity}>确认创建</button></div>
      {:else if dialog === "task"}
        <label>项目<select bind:value={projectPath}><option value="">选择项目</option>{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</select></label>
        <label>任务<textarea bind:value={taskText} rows="3" placeholder="描述下一步具体行动"></textarea></label>
        <div class="qwb-form-row"><label>截止日期<input type="date" bind:value={taskDue} /></label><label>优先级<select bind:value={taskPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label></div>
        <div class="qwb-inline-preview"><strong>写入预览</strong><div>{taskText || "未填写任务"}{taskDue ? ` · 截止 ${taskDue}` : ""}</div><small>{projectPath || "尚未选择项目"}</small></div>
        <div class="qwb-modal-actions"><button class="qwb-button qwb-button-subtle" on:click={() => (dialog = null)}>取消</button><button class="qwb-button qwb-button-primary" disabled={!controller.settings.writesEnabled || !projectPath || !taskText.trim() || busy} on:click={submitTask}>添加任务</button></div>
      {:else if dialog === "task-edit"}
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
