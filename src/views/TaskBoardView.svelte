<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { TaskRecord, TaskScope } from "../core/types";
  import type { WorkbenchController, WorkbenchSnapshot } from "../ui/controller";
  import { EMPTY_SNAPSHOT } from "../ui/controller";

  export let controller: WorkbenchController;

  type BoardMode = "timeline" | "status";
  type ScopeFilter = TaskScope | "all";
  type ColumnId = "backlog" | "due" | "next-seven" | "undated" | "todo" | "doing" | "waiting" | "done";

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
    { id: "done", title: "已完成", hint: "最近完成项", tone: "done" }
  ];

  const statusColumns: Omit<BoardColumn, "tasks">[] = [
    { id: "todo", title: "待办", hint: "默认状态", tone: "backlog" },
    { id: "doing", title: "进行中", hint: "#doing / #进行中", tone: "next" },
    { id: "waiting", title: "等待", hint: "#waiting / #blocked", tone: "due" },
    { id: "done", title: "已完成", hint: "已勾选", tone: "done" }
  ];

  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let mode: BoardMode = "timeline";
  let scope: ScopeFilter = "all";
  let query = "";
  let unsubscribe = () => {};
  let busyKey = "";
  let message = "";
  let editingKey = "";
  let editingTask: TaskRecord | undefined;
  let migratingKey = "";
  let migrationTarget = "";
  let editDue = "";
  let editPriority: TaskRecord["priority"] = "normal";

  $: filteredTasks = snapshot.tasks
    .filter((task) => scope === "all" || task.scope === scope)
    .filter((task) => {
      const needle = query.trim().toLocaleLowerCase("zh-CN");
      return !needle || `${task.text} ${task.sourceName} ${task.path}`.toLocaleLowerCase("zh-CN").includes(needle);
    })
    .sort(compareTasks);
  $: columns = (mode === "timeline" ? timelineColumns : statusColumns).map((column) => ({
    ...column,
    tasks: filteredTasks.filter((task) => bucketFor(task, mode) === column.id)
  }));

  onMount(() => {
    unsubscribe = controller.subscribe((next) => (snapshot = next));
  });
  onDestroy(() => unsubscribe());

  function taskKey(task: TaskRecord): string {
    return `${task.scope}:${task.path}:${task.line}:${task.id}`;
  }

  function taskDate(task: TaskRecord): string | undefined {
    return normalizeDate(task.due ?? task.scheduled);
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
    const prefix = taskDue(task) ? "" : "计划 ";
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
    migratingKey = "";
    editDue = taskDue(task) ?? "";
    editPriority = task.priority ?? "normal";
    message = "";
  }

  function beginMigration(task: TaskRecord): void {
    migratingKey = taskKey(task);
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
      migratingKey = "";
      migrationTarget = "";
    }
  }

  function cancelEdit(): void {
    editingKey = "";
    editingTask = undefined;
  }

  async function saveEdit(): Promise<void> {
    if (!editingTask) return;
    const task = editingTask;
    const patch: { due?: string | null; priority?: TaskRecord["priority"] } = {};
    const currentDate = taskDue(task) ?? "";
    if (editDue !== currentDate) patch.due = editDue || null;
    if (editPriority !== (task.priority ?? "normal")) patch.priority = editPriority;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    if (await run(task, () => controller.updateTask(task, patch), "任务已更新")) cancelEdit();
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

<div class="qwb-task-board">
  <header class="qwb-task-board-header">
    <div>
      <span class="qwb-task-board-eyebrow">TASK BOARD · 0.2.0</span>
      <h1>任务看板</h1>
      <p>统一查看项目任务、客户行动和待迁移会议草稿。</p>
    </div>
    <div class="qwb-task-board-actions">
      <span class:enabled={controller.settings.writesEnabled} class="qwb-task-board-write-state">
        <i></i>{controller.settings.writesEnabled ? "可编辑" : "只读诊断"}
      </span>
      <button on:click={refresh}>刷新</button>
    </div>
  </header>

  <div class="qwb-task-board-toolbar">
    <div class="qwb-task-board-segmented" aria-label="看板分组方式">
      <button class:active={mode === "timeline"} on:click={() => (mode = "timeline")}>按日期</button>
      <button class:active={mode === "status"} on:click={() => (mode = "status")}>按状态</button>
    </div>
    <label>
      <span>来源</span>
      <select bind:value={scope}>
        <option value="all">全部来源</option>
        <option value="project">项目任务</option>
        <option value="client">客户行动</option>
        <option value="meeting-draft">会议草稿</option>
      </select>
    </label>
    <label class="qwb-task-board-search">
      <span>搜索</span>
      <input bind:value={query} type="search" placeholder="任务、来源或文件…" />
    </label>
    <strong>{filteredTasks.length} 项</strong>
  </div>

  {#if message}<div class="qwb-task-board-message">{message}</div>{/if}

  <main class="qwb-task-board-columns" class:status-mode={mode === "status"}>
    {#each columns as column (column.id)}
      <section class="qwb-task-board-column" data-tone={column.tone}>
        <header>
          <div><h2>{column.title}</h2><small>{column.hint}</small></div>
          <strong>{column.tasks.length}</strong>
        </header>

        <div class="qwb-task-board-stack">
          {#each column.tasks as task (taskKey(task))}
            <article class:completed={task.completed} class:busy={busyKey === taskKey(task)} class="qwb-task-board-card">
              <div class="qwb-task-board-card-topline">
                <span class="qwb-task-board-scope {task.scope}">{sourceLabel(task)}</span>
                <span class="qwb-task-board-priority {task.priority ?? 'normal'}">{priorityLabel(task.priority)}</span>
              </div>

              <button class="qwb-task-board-title" on:click={() => controller.openPath(task.path)}>{task.text}</button>

              <div class="qwb-task-board-meta">
                <button title={task.path} on:click={() => controller.openPath(task.path)}>{task.sourceName}</button>
                <time class={dateTone(task)}>{dateLabel(task)}</time>
              </div>

              {#if migratingKey === taskKey(task)}
                <div class="qwb-task-board-editor">
                  <label><span>目标</span><select bind:value={migrationTarget}><option value="">选择项目或客户</option><optgroup label="项目">{#each snapshot.projects as project}<option value={project.path}>{project.name}</option>{/each}</optgroup><optgroup label="客户">{#each snapshot.clients as client}<option value={client.path}>{client.name}</option>{/each}</optgroup></select></label>
                  <div><button on:click={() => (migratingKey = "")}>取消</button><button class="primary" disabled={!migrationTarget || busyKey === taskKey(task)} on:click={() => saveMigration(task)}>预检并迁移</button></div>
                </div>
              {:else if editingKey === taskKey(task)}
                <div class="qwb-task-board-editor">
                  <label><span>截止日期</span><input type="date" bind:value={editDue} /></label>
                  {#if task.scheduled}<small>原任务计划日期：{task.scheduled}（本编辑器不会改写计划日期）</small>{/if}
                  <label><span>优先级</span><select bind:value={editPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label>
                  <div><button on:click={cancelEdit}>取消</button><button class="primary" disabled={busyKey === taskKey(task)} on:click={saveEdit}>保存</button></div>
                </div>
              {:else}
                <footer>
                  <button on:click={() => controller.openPath(task.path)}>打开来源</button>
                  {#if task.scope === "meeting-draft" && !task.completed}<button disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => beginMigration(task)}>迁移</button>{/if}
                  <button disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => beginEdit(task)}>编辑 / 改期</button>
                  <button class="complete" disabled={!controller.settings.writesEnabled || Boolean(busyKey)} on:click={() => run(task, () => controller.updateTask(task, { completed: !task.completed }), task.completed ? "任务已恢复" : "任务已完成")}>{task.completed ? "恢复" : "完成"}</button>
                </footer>
              {/if}
            </article>
          {:else}
            <p class="qwb-task-board-empty">这一栏暂时没有任务。</p>
          {/each}
        </div>
      </section>
    {/each}
  </main>
</div>
