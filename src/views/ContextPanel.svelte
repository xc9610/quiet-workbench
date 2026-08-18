<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { TaskRecord } from "../core/types";
  import { formatDate } from "../services/template-service";
  import type { WorkbenchController, WorkbenchSnapshot } from "../ui/controller";
  import { layoutItemKey } from "../core/layout";
  import { EMPTY_SNAPSHOT } from "../ui/controller";

  export let controller: WorkbenchController;
  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let unsubscribe = () => {};
  let upcoming: TaskRecord[] = [];

  $: upcoming = collectUpcomingTasks(snapshot.tasks);

  function collectUpcomingTasks(tasks: TaskRecord[]): TaskRecord[] {
    const today = new Date();
    const untilDate = new Date(today);
    untilDate.setDate(today.getDate() + 7);
    const until = formatDate(untilDate, "YYYY-MM-DD");
    return tasks
      .filter((task) => !task.completed && task.due && task.due <= until)
      .sort((left, right) => (left.due ?? "").localeCompare(right.due ?? ""))
      .slice(0, 10);
  }

  function isOverdue(task: TaskRecord): boolean {
    return Boolean(task.due && task.due < formatDate(new Date(), "YYYY-MM-DD"));
  }

  function scopeLabel(scope: TaskRecord["scope"]): string {
    return { project: "项目", client: "客户", "meeting-draft": "会议" }[scope];
  }

  function sidebarItems() {
    const layout = controller.settings.layouts.find(
      (entry) => entry.surface === "sidebar" && entry.id === controller.settings.activeSidebarLayout
    );
    return (layout?.items ?? [])
      .filter((item) => !item.hidden)
      .sort((left, right) => left.y - right.y);
  }

  onMount(() => {
    unsubscribe = controller.subscribe((next) => (snapshot = next));
  });
  onDestroy(() => unsubscribe());
</script>

<div class="qwb-context">
  {#each sidebarItems() as item (layoutItemKey(item))}
    {#if item.widgetId === "core.context"}
      <header class:collapsed={item.collapsed}>
        <span class="qwb-eyebrow">CURRENT CONTEXT</span>
        <h2>{snapshot.context.title}</h2>
        <div class="qwb-context-meta">{#if snapshot.context.kind}<span>{snapshot.context.kind}</span>{/if}{#if snapshot.context.status}<span>{snapshot.context.status}</span>{/if}</div>
        {#if snapshot.context.path && !item.collapsed}<button class="qwb-button qwb-button-subtle qwb-full" on:click={() => controller.openPath(snapshot.context.path!)}>打开当前笔记</button>{/if}
      </header>
    {:else if item.widgetId === "tasks.upcoming"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3>近期待办</h3><strong>{upcoming.length}</strong></div>
        {#if !item.collapsed}{#each upcoming as task}<button class:overdue={isOverdue(task)} class="qwb-context-row" on:click={() => controller.openPath(task.path)}><i class={task.scope}></i><span><small>{scopeLabel(task.scope)}</small>{task.text}</span>{#if task.due}<time>{task.due}</time>{/if}</button>{:else}<p class="qwb-empty">未来 7 天没有已标记日期的待办。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "tasks.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3>相关任务</h3><strong>{snapshot.context.tasks.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.tasks.slice(0, 8) as task}<button class="qwb-context-row" on:click={() => controller.openPath(task.path)}><i class={task.scope}></i><span>{task.text}</span>{#if task.due}<time>{task.due}</time>{/if}</button>{:else}<p class="qwb-empty">当前笔记没有关联任务。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "projects.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3>相关项目</h3><strong>{snapshot.context.relatedProjects.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.relatedProjects.slice(0, 6) as project}<button class="qwb-context-row" on:click={() => controller.openPath(project.path)}><span>{project.name}</span><b>›</b></button>{:else}<p class="qwb-empty">当前笔记没有关联项目。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "meetings.context"}
      <section class:collapsed={item.collapsed}>
        <div class="qwb-section-title"><h3>近期会议</h3><strong>{snapshot.context.meetings.length}</strong></div>
        {#if !item.collapsed}{#each snapshot.context.meetings.slice(0, 5) as meeting}<button class="qwb-context-row" on:click={() => controller.openPath(meeting.path)}><span>{meeting.name}</span><b>›</b></button>{:else}<p class="qwb-empty">当前笔记没有关联会议。</p>{/each}{/if}
      </section>
    {:else if item.widgetId === "core.quick-create"}
      <button class="qwb-button qwb-button-subtle qwb-full" on:click={() => controller.refresh()}>刷新上下文</button>
    {/if}
  {/each}

  <footer>
    <span class:enabled={controller.settings.writesEnabled} class="qwb-write-state"><span class="qwb-state-dot"></span>{controller.settings.writesEnabled ? "写入已启用" : "只读诊断"}</span>
    {#if snapshot.scannedAt}<time>更新于 {new Date(snapshot.scannedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>{/if}
  </footer>
</div>
