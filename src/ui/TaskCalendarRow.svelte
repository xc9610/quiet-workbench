<script lang="ts">
  import { setIcon } from "obsidian";
  import type { TaskRecord } from "../core/types";
  import type { TaskCalendarEntry } from "../domain/task-calendar";

  export let entry: TaskCalendarEntry;
  export let writesEnabled = false;
  export let busy = false;
  export let compact = false;
  export let onComplete: (task: TaskRecord, completed: boolean) => void = () => {};
  export let onCancel: (task: TaskRecord) => void = () => {};
  export let onRestore: (task: TaskRecord) => void = () => {};
  export let onOpen: (path: string) => void = () => {};
  export let onEdit: (task: TaskRecord) => void = () => {};
  export let onMigrate: (task: TaskRecord) => void = () => {};

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }

  $: task = entry.task;
  $: statusLabel = task.cancelled ? "已取消" : task.completed ? "已完成" : entry.dateRole === "scheduled" ? "计划" : "截止";
  $: description = `${task.text} · ${task.sourceName} · ${statusLabel}${task.scheduled && task.due ? ` · 计划 ${task.scheduled} · 截止 ${task.due}` : ""}`;
</script>

<div class="qwb-task-calendar-row" class:compact class:completed={task.completed && !task.cancelled} class:cancelled={task.cancelled} data-scope={task.scope} title={description}>
  {#if task.cancelled}
    <button class="qwb-task-calendar-check" use:obsidianIcon={"rotate-ccw"} disabled={!writesEnabled || busy} aria-label={`恢复任务：${task.text}`} title="恢复为未完成" on:click={() => onRestore(task)}></button>
  {:else}
    <label class="qwb-task-calendar-check">
      <input type="checkbox" checked={task.completed} disabled={!writesEnabled || busy} aria-label={`${task.completed ? "恢复" : "完成"}任务：${task.text}`} on:change={(event) => onComplete(task, event.currentTarget.checked)} />
    </label>
  {/if}
  <button class="qwb-task-calendar-entry-title" aria-label={description} on:click={() => onOpen(task.path)}>
    <strong>{task.text}</strong>
    {#if !compact}<small>{task.sourceName}{#if task.scheduled && task.due} · 计划 {task.scheduled} · 截止 {task.due}{/if}</small>{/if}
  </button>
  <span class="qwb-task-calendar-role">{statusLabel}</span>
  {#if !compact}
    {#if task.scope === "meeting-draft" && !task.completed}<button class="qwb-task-calendar-action" disabled={!writesEnabled || busy} on:click={() => onMigrate(task)}>迁移</button>{/if}
    <button class="qwb-task-calendar-action" use:obsidianIcon={"pencil"} disabled={!writesEnabled || busy} aria-label={`编辑任务：${task.text}`} title="编辑 / 改期" on:click={() => onEdit(task)}></button>
  {/if}
  {#if !task.cancelled}
    <button class="qwb-task-calendar-action cancel" use:obsidianIcon={"ban"} disabled={!writesEnabled || busy} aria-label={`取消任务：${task.text}`} title="取消任务（保留记录）" on:click={() => onCancel(task)}></button>
  {/if}
</div>
