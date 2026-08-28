<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setIcon } from "obsidian";
  import type { LayoutItem, TaskRecord } from "../core/types";
  import { formatDate } from "../services/template-service";
  import type { WorkbenchController, WorkbenchSnapshot } from "../ui/controller";
  import { layoutItemKey } from "../core/layout";
  import { EMPTY_SNAPSHOT } from "../ui/controller";
  import { effectiveTaskDate } from "../domain/widget-data";
  import { resolveSidebarProfile, sidebarTaskSource, SIDEBAR_PROFILE_NAMES } from "../core/sidebar-context";

  export let controller: WorkbenchController;
  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let unsubscribe = () => {};
  let upcoming: TaskRecord[] = [];
  let sidebarLayoutItems: LayoutItem[] = [];
  let memoDraft = "";
  let busy = false;
  let message = "";

  $: upcoming = collectUpcomingTasks([...sidebarTaskSource(snapshot.context, snapshot.context.tasks, snapshot.tasks)]);
  $: sidebarLayoutItems = resolveSidebarItems(
    resolveSidebarProfile(snapshot.context),
    controller.settings.sidebarProfiles,
    controller.settings.activeSidebarLayout,
    controller.settings.layouts
  );

  function collectUpcomingTasks(tasks: TaskRecord[]): TaskRecord[] {
    const today = new Date();
    const untilDate = new Date(today);
    untilDate.setDate(today.getDate() + 7);
    const until = formatDate(untilDate, "YYYY-MM-DD");
    return tasks
      .filter((task) => !task.completed && !task.migrated && effectiveTaskDate(task) && effectiveTaskDate(task)! <= until)
      .sort((left, right) => (effectiveTaskDate(left) ?? "").localeCompare(effectiveTaskDate(right) ?? ""))
      .slice(0, 10);
  }

  function isOverdue(task: TaskRecord): boolean {
    return Boolean(effectiveTaskDate(task) && effectiveTaskDate(task)! < formatDate(new Date(), "YYYY-MM-DD"));
  }

  function scopeLabel(scope: TaskRecord["scope"]): string {
    return { project: "项目", client: "客户", "meeting-draft": "会议" }[scope];
  }

  function scopeIcon(scope: TaskRecord["scope"]): string {
    return { project: "folder", client: "users", "meeting-draft": "calendar" }[scope];
  }

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }

  function resolveSidebarItems(
    profile: ReturnType<typeof resolveSidebarProfile>,
    profiles: WorkbenchController["settings"]["sidebarProfiles"],
    fallbackLayoutId: string,
    layouts: WorkbenchController["settings"]["layouts"]
  ): LayoutItem[] {
    const layoutId = profiles[profile] ?? fallbackLayoutId;
    const layout = layouts.find(
      (entry) => entry.surface === "sidebar" && entry.id === layoutId
    );
    return (layout?.items ?? [])
      .filter((item) => !item.hidden)
      .sort((left, right) => left.y - right.y);
  }

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    busy = true;
    message = "";
    try {
      await action();
      message = success;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function submitMemo(): Promise<void> {
    const value = memoDraft.trim();
    if (!value) return;
    await run(() => controller.appendQuickMemo(value), "已记录");
    if (message === "已记录") memoDraft = "";
  }

  function handleMemoKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitMemo();
  }

  onMount(() => {
    unsubscribe = controller.subscribe((next) => (snapshot = next));
  });
  onDestroy(() => unsubscribe());
</script>

<div class="qwb-context">
  <div class="qwb-context-profile"><span><i use:obsidianIcon={"panel-right"}></i>{SIDEBAR_PROFILE_NAMES[resolveSidebarProfile(snapshot.context)]}</span><small>自动上下文</small></div>
  {#each sidebarLayoutItems as item (layoutItemKey(item))}
    {#if item.widgetId === "core.context"}
      <header class:collapsed={item.collapsed}>
        <span class="qwb-eyebrow">CURRENT CONTEXT</span>
        <h2>{snapshot.context.title}</h2>
        <div class="qwb-context-meta">{#if snapshot.context.kind}<span>{snapshot.context.kind}</span>{/if}{#if snapshot.context.status}<span>{snapshot.context.status}</span>{/if}</div>
        {#if snapshot.context.path && !item.collapsed}<button class="qwb-button qwb-button-subtle qwb-full" on:click={() => controller.openPath(snapshot.context.path!)}>打开当前笔记</button>{/if}
      </header>
    {:else if item.widgetId === "tasks.upcoming"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"list-checks"}></i>近期待办</h3><strong>{upcoming.length}</strong></div>
        {#if !item.collapsed}{#each upcoming as task}<button class:overdue={isOverdue(task)} class="qwb-context-row" on:click={() => controller.openPath(task.path)}><i class={task.scope} use:obsidianIcon={scopeIcon(task.scope)}></i><span><small>{scopeLabel(task.scope)} · {task.sourceName}</small>{task.text}</span>{#if effectiveTaskDate(task)}<time>{effectiveTaskDate(task)}</time>{/if}</button>{:else}<p class="qwb-empty">未来 7 天没有已标记日期的待办。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "capture.memo"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"notebook-pen"}></i>速记</h3><button class="qwb-context-text-action" disabled={!snapshot.memo.exists} on:click={() => controller.openPath(snapshot.memo.path)}>打开文件</button></div>
        {#if !item.collapsed}
          <div class="qwb-context-memo">
            <textarea bind:value={memoDraft} rows="3" placeholder="记下一条；自动添加时间。" on:keydown={handleMemoKeydown}></textarea>
            <div><small>Enter 记录 · Shift + Enter 换行</small><button disabled={busy || !controller.settings.writesEnabled || !memoDraft.trim()} on:click={submitMemo}>记录</button></div>
          </div>
        {/if}
      </section>
    {:else if item.widgetId === "tasks.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"check-square"}></i>相关任务</h3><strong>{snapshot.context.tasks.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.tasks.slice(0, 8) as task}<button class="qwb-context-row" on:click={() => controller.openPath(task.path)}><i class={task.scope} use:obsidianIcon={scopeIcon(task.scope)}></i><span>{task.text}</span>{#if task.due}<time>{task.due}</time>{/if}</button>{:else}<p class="qwb-empty">当前笔记没有关联任务。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "projects.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"folder-kanban"}></i>相关项目</h3><strong>{snapshot.context.relatedProjects.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.relatedProjects.slice(0, 6) as project}<button class="qwb-context-row" on:click={() => controller.openPath(project.path)}><i use:obsidianIcon={"folder"}></i><span>{project.name}</span><b>›</b></button>{:else}<p class="qwb-empty">当前笔记没有关联项目。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "meetings.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"calendar-days"}></i>近期会议</h3><strong>{snapshot.context.meetings.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.meetings.slice(0, 5) as meeting}<button class="qwb-context-row" on:click={() => controller.openPath(meeting.path)}><i use:obsidianIcon={"calendar"}></i><span>{meeting.name}</span><b>›</b></button>{:else}<p class="qwb-empty">当前笔记没有关联会议。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "core.quick-create"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3><i use:obsidianIcon={"zap"}></i>快捷入口</h3></div>
        {#if !item.collapsed}<div class="qwb-context-actions"><button on:click={() => controller.openWorkbench()}><i use:obsidianIcon={"asterism-mark"}></i>工作台</button><button on:click={() => controller.openTaskBoard()}><i use:obsidianIcon={"list-todo"}></i>任务看板</button><button disabled={busy} on:click={() => run(() => controller.refresh(), "已刷新")}><i use:obsidianIcon={"refresh-cw"}></i>刷新</button></div>{/if}
      </section>
    {/if}
  {/each}

  {#if message}<p class="qwb-context-message" role="status">{message}</p>{/if}

  <footer>
    <span class:enabled={controller.settings.writesEnabled} class="qwb-write-state"><span class="qwb-state-dot"></span>{controller.settings.writesEnabled ? "写入已启用" : "只读诊断"}</span>
    {#if snapshot.scannedAt}<time>更新于 {new Date(snapshot.scannedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>{/if}
  </footer>
</div>
