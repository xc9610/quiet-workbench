<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ASTERISM_VERSION } from "../core/version";
  import { Platform, setIcon } from "obsidian";
  import type { TaskRecord, TaskScope } from "../core/types";
  import {
    effectiveTaskDate,
    suggestedTaskBoardDrop,
    type TaskBoardDateColumn
  } from "../domain/widget-data";
  import type { WorkbenchController, WorkbenchSnapshot } from "../ui/controller";
  import { EMPTY_SNAPSHOT } from "../ui/controller";
  import TaskMonthView from "../ui/TaskMonthView.svelte";
  import { matchesTaskStatus, type TaskCalendarDateMode, type TaskStatusFilter } from "../domain/task-calendar";

  import { subscribeVisible } from "../ui/view-subscription";
  let shellEl: HTMLElement;
  export let controller: WorkbenchController;
  export let initialView: "board" | "calendar" = "board";
  export let onViewChange: (view: "board" | "calendar") => void = () => {};

  type BoardMode = "timeline" | "status";
  type ScopeFilter = TaskScope | "all";
  type TimelineColumnId = TaskBoardDateColumn;
  type ColumnId = TimelineColumnId | "todo" | "doing" | "waiting" | "cancelled";

  interface BoardColumn {
    id: ColumnId;
    title: string;
    hint: string;
    tone: string;
    tasks: TaskRecord[];
  }

  const timelineColumns: Omit<BoardColumn, "tasks">[] = [
    { id: "backlog", title: "Backlog", hint: "七天以后", tone: "backlog" },
    { id: "due", title: "今天与逾期", hint: "需要优先处理", tone: "due" },
    { id: "next-seven", title: "未来 7 天", hint: "即将到期", tone: "next" },
    { id: "undated", title: "无日期", hint: "尚未排期", tone: "undated" },
    { id: "done", title: "已完成", hint: "已勾选", tone: "done" },
    { id: "cancelled", title: "已取消", hint: "保留记录，可恢复", tone: "cancelled" }
  ];

  const statusColumns: Omit<BoardColumn, "tasks">[] = [
    { id: "todo", title: "待办", hint: "默认状态", tone: "backlog" },
    { id: "doing", title: "进行中", hint: "#doing / #进行中", tone: "next" },
    { id: "waiting", title: "等待", hint: "#waiting / #blocked", tone: "due" },
    { id: "done", title: "已完成", hint: "已勾选", tone: "done" },
    { id: "cancelled", title: "已取消", hint: "保留记录，可恢复", tone: "cancelled" }
  ];

  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let mode: BoardMode = "timeline";
  let view = initialView;
  let scope: ScopeFilter = "all";
  let status: TaskStatusFilter = "all";
  let calendarDateMode: TaskCalendarDateMode = "effective";
  const today = localDateKey(new Date());
  let calendarMonth = today.slice(0, 7);
  let calendarSelected = today;
  let query = "";
  let unsubscribe = () => {};
  let busyKey = "";
  let message = "";
  let editingKey = "";
  let editingTask: TaskRecord | undefined;
  let migratingTask: TaskRecord | undefined;
  let migrationTarget = "";
  let editDue = "";
  let editPriority: TaskRecord["priority"] = "normal";
  let editCompleted: boolean | undefined;
  let editReason = "";
  let draggedTask: TaskRecord | undefined;
  let dragOverColumn: TimelineColumnId | undefined;
  const isDesktop = !Platform.isMobile;

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }

  $: filteredTasks = snapshot.tasks
    .filter((task) => !task.migrated)
    .filter((task) => scope === "all" || task.scope === scope)
    .filter((task) => matchesTaskStatus(task, status))
    .filter((task) => {
      const needle = query.trim().toLocaleLowerCase("zh-CN");
      return !needle || `${task.text} ${task.sourceName} ${task.path}`.toLocaleLowerCase("zh-CN").includes(needle);
    })
    .sort(compareTasks);
  $: columns = (mode === "timeline" ? timelineColumns : statusColumns).map((column) => ({
    ...column,
    tasks: filteredTasks.filter((task) => bucketFor(task, mode) === column.id)
  }));
  $: onViewChange(view);

  export function selectView(next: "board" | "calendar"): void {
    view = next;
    finishDrag();
  }

  onMount(() => {
    const subscription = subscribeVisible(controller, shellEl, (next) => (snapshot = next));
    unsubscribe = () => subscription.dispose();
  });
  onDestroy(() => unsubscribe());

  function taskKey(task: TaskRecord): string {
    return `${task.scope}:${task.path}:${task.line}:${task.id}`;
  }

  function taskDate(task: TaskRecord): string | undefined {
    return normalizeDate(effectiveTaskDate(task));
  }

  function taskDue(task: TaskRecord): string | undefined {
    return normalizeDate(task.due);
  }

  function normalizeDate(value?: string): string | undefined {
    return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  }

  function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function daysFromToday(days: number): string {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function bucketFor(task: TaskRecord, boardMode: BoardMode): ColumnId {
    if (task.cancelled) return "cancelled";
    if (task.completed) return "done";
    if (boardMode === "status") return statusBucket(task);
    const date = taskDate(task);
    if (!date) return "undated";
    const today = localDateKey(new Date());
    if (date <= today) return "due";
    if (date <= daysFromToday(7)) return "next-seven";
    return "backlog";
  }

  function statusBucket(task: TaskRecord): ColumnId {
    const text = task.text.toLocaleLowerCase("zh-CN");
    if (/#(?:doing|in-progress)\b/u.test(text) || /#进行中(?=\s|$)/u.test(text) || /status::\s*(?:doing|in-progress|进行中)/u.test(text)) return "doing";
    if (/#(?:waiting|blocked)\b/u.test(text) || /#(?:等待|阻塞)(?=\s|$)/u.test(text) || /status::\s*(?:waiting|blocked|等待|阻塞)/u.test(text)) return "waiting";
    return "todo";
  }

  function compareTasks(left: TaskRecord, right: TaskRecord): number {
    if (Boolean(left.cancelled) !== Boolean(right.cancelled)) return left.cancelled ? 1 : -1;
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    const leftDate = taskDate(left) ?? "9999-12-31";
    const rightDate = taskDate(right) ?? "9999-12-31";
    return leftDate.localeCompare(rightDate) || priorityRank(left.priority) - priorityRank(right.priority) || left.text.localeCompare(right.text, "zh-CN");
  }

  function priorityRank(priority?: TaskRecord["priority"]): number {
    return ({ highest: 0, high: 1, normal: 2, low: 3, lowest: 4 } as const)[priority ?? "normal"];
  }

  function sourceLabel(task: TaskRecord): string {
    return task.scope === "project" ? "项目" : task.scope === "client" ? "客户行动" : "会议草稿";
  }

  function priorityLabel(priority?: TaskRecord["priority"]): string {
    return ({ highest: "最高", high: "高", normal: "普通", low: "低", lowest: "最低" } as const)[priority ?? "normal"];
  }

  function dateLabel(task: TaskRecord): string {
    const date = taskDate(task);
    if (!date) return "未排期";
    const prefix = task.scheduled ? "计划 " : "截止 ";
    const today = localDateKey(new Date());
    if (!task.completed && date < today) return `${prefix}逾期 ${date}`;
    if (date === today) return `${prefix}今天 ${date}`;
    return `${prefix}${date}`;
  }

  function dateTone(task: TaskRecord): string {
    const date = taskDate(task);
    if (!date || task.completed) return "";
    const today = localDateKey(new Date());
    return date < today ? "overdue" : date === today ? "today" : "";
  }

  async function run(task: TaskRecord, action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (busyKey) return false;
    const key = taskKey(task);
    busyKey = key;
    message = "";
    try {
      await action();
      message = success;
      return true;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      snapshot = { ...snapshot };
      return false;
    } finally {
      busyKey = "";
    }
  }

  function beginEdit(task: TaskRecord): void {
    editingKey = taskKey(task);
    editingTask = { ...task };
    migratingTask = undefined;
    editDue = taskDue(task) ?? "";
    editPriority = task.priority ?? "normal";
    editCompleted = undefined;
    editReason = "";
    message = "";
  }

  async function beginPreferredEdit(task: TaskRecord): Promise<void> {
    if (!controller.tasksIntegrationAvailable()) {
      beginEdit(task);
      return;
    }
    const key = taskKey(task);
    busyKey = key;
    message = "";
    try {
      const result = await controller.editTaskWithTasks(task);
      if (result === "committed") message = "任务已通过 Tasks 更新";
      else if (result === "unavailable") beginEdit(task);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busyKey = "";
    }
  }

  function beginMigration(task: TaskRecord): void {
    migratingTask = { ...task };
    editingKey = "";
    editingTask = undefined;
    migrationTarget = "";
    message = "";
  }

  async function saveMigration(task: TaskRecord): Promise<void> {
    if (!migrationTarget) {
      message = "请先选择迁移目标项目或客户。";
      return;
    }
    const targetName = [...snapshot.projects, ...snapshot.clients].find((entry) => entry.path === migrationTarget)?.name ?? migrationTarget;
    if (await run(task, () => controller.migrateMeetingTask(task, migrationTarget), `已迁移到「${targetName}」`)) {
      migratingTask = undefined;
      migrationTarget = "";
    }
  }

  function cancelEdit(): void {
    editingKey = "";
    editingTask = undefined;
    editCompleted = undefined;
    editReason = "";
  }

  function completeTask(task: TaskRecord, completed: boolean): void {
    void run(task, () => controller.updateTask(task, { completed }), completed ? "任务已完成" : "任务已恢复为未完成");
  }

  function cancelTask(task: TaskRecord): void {
    void run(task, () => controller.updateTask(task, { cancelled: true }), "任务已取消，可恢复或撤销");
  }

  function restoreTask(task: TaskRecord): void {
    void run(task, () => controller.updateTask(task, { cancelled: false, completed: false }), "任务已恢复为未完成");
  }

  async function undo(): Promise<void> {
    if (busyKey) return;
    busyKey = "undo";
    message = "";
    try {
      await controller.undoLastTransaction();
      message = "已撤销上一次操作";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busyKey = "";
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editingTask) return;
    const task = editingTask;
    const patch: { completed?: boolean; due?: string | null; priority?: TaskRecord["priority"] } = {};
    const currentDate = taskDue(task) ?? "";
    if (editDue !== currentDate) patch.due = editDue || null;
    if (editPriority !== (task.priority ?? "normal")) patch.priority = editPriority;
    if (editCompleted !== undefined && editCompleted !== task.completed) patch.completed = editCompleted;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    const success = editReason ? "任务已移动" : "任务已更新";
    if (await run(task, () => controller.updateTask(task, patch), success)) cancelEdit();
  }

  function handleBoardKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !editReason) return;
    // Ignore Esc pressed in another pane or window.
    const target = event.target;
    const inBoard = target instanceof Node && shellEl?.contains(target);
    const onActivePage = target === shellEl?.ownerDocument.body && Boolean(shellEl?.closest(".workspace-leaf.mod-active"));
    if (inBoard || onActivePage) cancelEdit();
  }

  /** Moves focus into the confirmation dialog so keyboard users land on it. */
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function canDrag(task: TaskRecord): boolean {
    return isDesktop
      && controller.settings.writesEnabled
      && mode === "timeline"
      && task.scope !== "meeting-draft"
      && !task.cancelled
      && !task.scheduled
      && !busyKey;
  }

  function dragHint(task: TaskRecord): string {
    if (!isDesktop) return "移动端请使用编辑 / 改期。";
    if (mode !== "timeline") return "按状态视图暂不支持拖拽。";
    if (task.scope === "meeting-draft") return "会议草稿必须先迁移。";
    if (task.cancelled) return "已取消任务请先恢复。";
    if (task.scheduled) return "含计划日期的任务请使用编辑 / 改期。";
    return "拖到其他日期列；放下后确认再写入。";
  }

  function startDrag(event: DragEvent, task: TaskRecord): void {
    if (!canDrag(task)) {
      event.preventDefault();
      return;
    }
    draggedTask = task;
    event.dataTransfer?.setData("text/plain", task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function finishDrag(): void {
    draggedTask = undefined;
    dragOverColumn = undefined;
  }

  function allowDrop(event: DragEvent, column: ColumnId): void {
    if (!draggedTask || mode !== "timeline" || !isTimelineColumn(column)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverColumn = column;
  }

  function dropTask(event: DragEvent, column: ColumnId): void {
    event.preventDefault();
    const task = draggedTask;
    finishDrag();
    if (!task || mode !== "timeline" || !isTimelineColumn(column) || bucketFor(task, mode) === column) return;
    editingKey = taskKey(task);
    editingTask = { ...task };
    editPriority = task.priority ?? "normal";
    const suggestion = suggestedTaskBoardDrop(column, localDateKey(new Date()), task.completed);
    editCompleted = suggestion.completed;
    editDue = suggestion.due === null ? "" : suggestion.due ?? taskDue(task) ?? "";
    editReason = column === "done"
      ? "将任务移入“已完成”。确认后才会勾选原 Markdown 任务。"
      : `将任务移入“${timelineColumns.find((entry) => entry.id === column)?.title ?? column}”。已填入建议日期，可先调整再保存。`;
    message = "";
  }

  function isTimelineColumn(column: ColumnId): column is TimelineColumnId {
    return ["backlog", "due", "next-seven", "undated", "done"].includes(column);
  }

  async function refresh(): Promise<void> {
    message = "";
    try {
      await controller.refresh();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<svelte:window on:keydown={handleBoardKeydown} />

<div bind:this={shellEl} class="qwb-task-board">
  <header class="qwb-task-board-header">
    <div>
      <span class="qwb-task-board-eyebrow">ASTERISM · TASKS · {ASTERISM_VERSION}</span>
      <h1>任务</h1>
      <p>项目任务、客户行动和会议草稿 · 看板与月历同步。</p>
    </div>
    <div class="qwb-task-board-actions qwb-page-nav" role="toolbar" aria-label="Asterism 页面导航与任务看板操作">
      <span class:enabled={controller.settings.writesEnabled} class="qwb-task-board-write-state">
        <i></i>{controller.settings.writesEnabled ? "可编辑" : "只读诊断"}
      </span>
      <span class="qwb-page-nav-divider" aria-hidden="true"></span>
      <button class="qwb-task-board-icon-button" use:obsidianIcon={"asterism-mark"} aria-label="打开工作台" title="工作台" on:click={() => controller.openWorkbench()}></button>
      <button class="qwb-task-board-icon-button is-current" use:obsidianIcon={"list-todo"} aria-label="当前页面：任务" title="任务" aria-current="page" on:click={() => controller.openTaskBoard()}></button>
      <button class="qwb-task-board-icon-button" use:obsidianIcon={"clipboard-check"} aria-label="打开项目审阅" title="项目审阅" on:click={() => controller.openProjectReview()}></button>
      <button class="qwb-task-board-icon-button" use:obsidianIcon={"panel-right-open"} aria-label="打开上下文侧栏" title="上下文侧栏" on:click={() => controller.openContextPanel()}></button>
      <span class="qwb-page-nav-divider" aria-hidden="true"></span>
      <button class="qwb-task-board-icon-button" use:obsidianIcon={"refresh-cw"} aria-label="刷新任务看板" title="刷新" on:click={refresh}></button>
      <button class="qwb-task-board-icon-button" use:obsidianIcon={"undo-2"} disabled={!controller.settings.writesEnabled || Boolean(busyKey) || !snapshot.lastReceipt} aria-label="撤销上一次操作" title="撤销上一次操作" on:click={undo}></button>
    </div>
  </header>

  <div class="qwb-task-board-toolbar">
    <div class="qwb-task-board-segmented" role="group" aria-label="任务视图">
      <button class:active={view === "board"} aria-pressed={view === "board"} on:click={() => selectView("board")}>看板</button>
      <button class:active={view === "calendar"} aria-pressed={view === "calendar"} on:click={() => selectView("calendar")}>月历</button>
    </div>
    {#if view === "board"}
      <label><span>分组</span><select bind:value={mode}><option value="timeline">按日期</option><option value="status">按状态</option></select></label>
    {/if}
    <label>
      <span>来源</span>
      <select bind:value={scope}>
        <option value="all">全部来源</option>
        <option value="project">项目任务</option>
        <option value="client">客户行动</option>
        <option value="meeting-draft">会议草稿</option>
      </select>
    </label>
    <label><span>状态</span><select bind:value={status}><option value="all">全部状态</option><option value="open">未完成</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
    <label class="qwb-task-board-search">
      <span>搜索</span>
      <input bind:value={query} type="search" placeholder="任务、来源或文件…" />
    </label>
    <strong>{filteredTasks.length} 项</strong>
  </div>

  {#if message}<div class="qwb-task-board-message" role="status">{message}</div>{/if}

  {#if migratingTask}
    <section class="qwb-task-page-editor" aria-label="迁移任务">
      <header><strong>{migratingTask.text}</strong><small>{migratingTask.sourceName}</small></header>
      <div class="qwb-task-board-editor">
        <label><span>目标</span><select bind:value={migrationTarget}><option value="">选择项目或客户</option><optgroup label="项目">{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</optgroup><optgroup label="客户">{#each snapshot.clients as client}<option value={client.path}>{client.name}</option>{/each}</optgroup></select></label>
        <div><button disabled={Boolean(busyKey)} on:click={() => { migratingTask = undefined; }}>关闭</button><button class="primary" disabled={!migrationTarget || Boolean(busyKey)} on:click={() => migratingTask && saveMigration(migratingTask)}>预检并迁移</button></div>
      </div>
    </section>
  {:else if editingTask && !editReason}
    <section class="qwb-task-page-editor" aria-label="编辑任务">
      <header><strong>{editingTask.text}</strong><small>{editingTask.sourceName}</small></header>
      <div class="qwb-task-board-editor">
        <label><span>截止日期</span><input type="date" bind:value={editDue} /></label>
        {#if editingTask.scheduled}<small>计划日期：{editingTask.scheduled}</small>{/if}
        <label><span>优先级</span><select bind:value={editPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label>
        <div><button disabled={Boolean(busyKey)} on:click={cancelEdit}>关闭</button><button class="primary" disabled={Boolean(busyKey)} on:click={saveEdit}>保存</button></div>
      </div>
    </section>
  {/if}

  {#if view === "calendar"}
    <TaskMonthView tasks={filteredTasks} writesEnabled={controller.settings.writesEnabled} busy={Boolean(busyKey)} {today} bind:month={calendarMonth} bind:selected={calendarSelected} bind:dateMode={calendarDateMode} onComplete={completeTask} onCancel={cancelTask} onRestore={restoreTask} onOpen={(path) => controller.openPath(path)} onEdit={beginPreferredEdit} onMigrate={beginMigration} onShowUndated={() => { selectView("board"); mode = "timeline"; }} />
  {:else}
  <main class="qwb-task-board-columns" class:status-mode={mode === "status"}>
    {#each columns as column (column.id)}
      <section role="group" aria-label={`${column.title}任务列`} class:drag-over={dragOverColumn === column.id} class="qwb-task-board-column" data-tone={column.tone} on:dragover={(event) => allowDrop(event, column.id)} on:drop={(event) => dropTask(event, column.id)}>
        <header>
          <div><h2>{column.title}</h2><small>{column.hint}</small></div>
          <strong>{column.tasks.length}</strong>
        </header>

        <div class="qwb-task-board-stack">
          {#each column.tasks as task (taskKey(task))}
            <article class:completed={task.completed && !task.cancelled} class:cancelled={task.cancelled} class:busy={busyKey === taskKey(task)} class:draggable={canDrag(task)} class:drop-pending={editingKey === taskKey(task) && Boolean(editReason)} class="qwb-task-board-card">
              <div class="qwb-task-board-card-topline">
                <span class="qwb-task-board-scope {task.scope}">{sourceLabel(task)}</span>
                <span class="qwb-task-board-card-controls">
                  <span class="qwb-task-board-priority {task.priority ?? 'normal'}">{priorityLabel(task.priority)}</span>
                  {#if mode === "timeline"}<button class="qwb-task-board-drag-handle" use:obsidianIcon={"grip-vertical"} draggable={canDrag(task)} disabled={!canDrag(task)} aria-label={`拖动任务：${task.text}`} title={dragHint(task)} on:dragstart={(event) => startDrag(event, task)} on:dragend={finishDrag}></button>{/if}
                </span>
              </div>

              <button class="qwb-task-board-title" on:click={() => controller.openPath(task.path)}>{task.text}</button>

              <div class="qwb-task-board-meta">
                <button title={task.path} on:click={() => controller.openPath(task.path)}>{task.sourceName}</button>
                <time class={dateTone(task)}>{dateLabel(task)}</time>
              </div>

                <footer>
                  <button on:click={() => controller.openPath(task.path)}>打开来源</button>
                  {#if task.scope === "meeting-draft" && !task.completed}<button disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => beginMigration(task)}>迁移</button>{/if}
                  <button disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => beginPreferredEdit(task)}>编辑 / 改期</button>
                  {#if task.cancelled}
                    <button class="complete" disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => restoreTask(task)}>恢复</button>
                  {:else}
                    <button class="cancel" disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => cancelTask(task)}>取消任务</button>
                    <label class="qwb-task-board-completion"><input type="checkbox" checked={task.completed} disabled={!controller.settings.writesEnabled || Boolean(busyKey)} aria-label={`${task.completed ? "恢复" : "完成"}任务：${task.text}`} on:change={(event) => completeTask(task, event.currentTarget.checked)} />{task.completed ? "已完成" : "完成"}</label>
                  {/if}
                </footer>
            </article>
          {:else}
            <p class="qwb-task-board-empty">这一栏暂时没有任务。</p>
          {/each}
        </div>
      </section>
    {/each}
  </main>
  {/if}

  {#if editingTask && editReason}
    <div class="qwb-task-board-drop-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && cancelEdit()}>
      <div class="qwb-task-board-drop-dialog" use:focusOnMount role="dialog" aria-modal="true" aria-labelledby="qwb-task-board-drop-title" tabindex="-1">
        <header>
          <div><small>移动任务</small><h2 id="qwb-task-board-drop-title">确认新的任务位置</h2></div>
          <button type="button" aria-label="关闭" on:click={cancelEdit}>×</button>
        </header>
        <div class="qwb-task-board-drop-task">
          <strong>{editingTask.text}</strong>
          <span>{sourceLabel(editingTask)} · {editingTask.sourceName}</span>
        </div>
        <p class="qwb-task-board-edit-reason">{editReason}</p>
        {#if editCompleted !== true}
          <label><span>新的截止日期</span><input type="date" bind:value={editDue} /></label>
        {:else}
          <div class="qwb-task-board-drop-complete">完成后会保留原截止日期，并在 Markdown 任务上写入完成状态。</div>
        {/if}
        <footer><button type="button" on:click={cancelEdit}>取消</button><button type="button" class="primary" disabled={busyKey === taskKey(editingTask)} on:click={saveEdit}>确认移动</button></footer>
      </div>
    </div>
  {/if}
</div>
