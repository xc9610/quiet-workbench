<script lang="ts">
  import type { TaskRecord } from "../../core/types";
  import { effectiveTaskDate } from "../../domain/widget-data";
  import WidgetState from "./WidgetState.svelte";
  export let rows: TaskRecord[] = [];
  export let count = 0;
  export let search = "";
  export let writesEnabled = false;
  export let busy = false;
  export let loaded = true;
  export let error = "";
  export let allowAdd = true;
  export let scopeLabel: (scope: TaskRecord["scope"]) => string;
  export let priorityLabel: (priority: TaskRecord["priority"]) => string;
  export let onSearch: (value: string) => void;
  export let onComplete: (task: TaskRecord, completed: boolean) => void;
  export let onOpen: (path: string) => void;
  export let onMigrate: (task: TaskRecord) => void;
  export let onSchedule: (task: TaskRecord) => void;
  export let onEdit: (task: TaskRecord) => void;
  export let onAdd: () => void;
  export let onRetry: () => void;
</script>
<div class="qwb-widget-search"><input value={search} aria-label="搜索任务" placeholder="搜索任务" on:input={(event) => onSearch(event.currentTarget.value)} /><span>{count}</span></div>
{#if error}<WidgetState kind="error" message={`刷新失败，保留上次数据。${error}`} actionLabel="重新刷新" onAction={onRetry} />{/if}
{#if !loaded && !rows.length}<WidgetState kind="loading" message="正在读取本地任务…" />{/if}
<div class="qwb-task-list">
  {#each rows as task (task.id)}
    <div class="qwb-task-row">
      <input type="checkbox" aria-label={`完成：${task.text}`} checked={task.completed} disabled={!writesEnabled || busy || task.scope === "meeting-draft"} on:change={(event) => onComplete(task, event.currentTarget.checked)} />
      <button class="qwb-link" title={task.text} on:click={() => onOpen(task.path)}><span class="qwb-task-title-text">{task.text}</span></button>
      <div class="qwb-task-meta"><span class="qwb-task-source" title={`${scopeLabel(task.scope)} · ${task.sourceName}`}><b>{scopeLabel(task.scope)}</b><em>{task.sourceName}</em></span><time>{effectiveTaskDate(task) ?? "未安排"}</time>{#if task.priority && task.priority !== "normal"}<span class:high={task.priority === "highest" || task.priority === "high"} class="qwb-task-priority">{priorityLabel(task.priority)}</span>{/if}</div>
      {#if task.scope === "meeting-draft"}<button class="qwb-row-action" disabled={!writesEnabled || busy} on:click={() => onMigrate(task)}>迁移</button>{:else}<div class="qwb-row-actions"><button class="qwb-row-action" disabled={!writesEnabled || busy} on:click={() => onSchedule(task)}>安排</button><button class="qwb-row-action" disabled={busy} on:click={() => onEdit(task)}>编辑</button></div>{/if}
    </div>
  {:else}
    {#if loaded}<WidgetState kind={search ? "filtered" : "empty"} message={search ? "当前筛选下没有任务。" : "当前组件范围内没有任务。"} actionLabel={search ? "清除搜索" : ""} onAction={() => onSearch("")} />{/if}
  {/each}
</div>
{#if allowAdd}<button class="qwb-text-action" on:click={onAdd}>＋ 添加项目任务</button>{/if}
