<script lang="ts">
  import { setIcon } from "obsidian";
  import { tick } from "svelte";
  import type { TaskRecord } from "../core/types";
  import { buildMonthCalendar, calendarDateLabel, calendarMonthLabel, shiftCalendarMonth } from "../domain/calendar";
  import { groupTaskCalendarEntries, taskCalendarEntry, type TaskCalendarDateMode } from "../domain/task-calendar";
  import TaskCalendarRow from "./TaskCalendarRow.svelte";

  export let tasks: TaskRecord[] = [];
  export let writesEnabled = false;
  export let busy = false;
  export let today: string;
  export let month: string;
  export let selected: string;
  export let dateMode: TaskCalendarDateMode = "effective";
  export let onComplete: (task: TaskRecord, completed: boolean) => void = () => {};
  export let onCancel: (task: TaskRecord) => void = () => {};
  export let onRestore: (task: TaskRecord) => void = () => {};
  export let onOpen: (path: string) => void = () => {};
  export let onEdit: (task: TaskRecord) => void = () => {};
  export let onMigrate: (task: TaskRecord) => void = () => {};
  export let onShowUndated: () => void = () => {};
  let detailEl: HTMLElement;

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }

  function selectDate(date: string) {
    selected = date;
    month = date.slice(0, 7);
  }

  function moveMonth(offset: number) {
    month = shiftCalendarMonth(month, offset);
    selected = month === today.slice(0, 7) ? today : `${month}-01`;
  }

  async function showDetail(date: string) {
    selectDate(date);
    await tick();
    detailEl?.scrollIntoView({ block: "nearest" });
  }

  $: cells = buildMonthCalendar(month, today);
  $: groups = groupTaskCalendarEntries(tasks, dateMode);
  $: detail = groups.get(selected) ?? [];
  $: monthCount = [...groups.entries()].filter(([date]) => date.startsWith(`${month}-`)).reduce((total, [, rows]) => total + rows.length, 0);
  $: undatedCount = tasks.filter((task) => !taskCalendarEntry(task, dateMode)).length;
  $: rowActions = { writesEnabled, busy, onComplete, onCancel, onRestore, onOpen, onEdit, onMigrate };
</script>

<main class="qwb-task-calendar">
  <header class="qwb-task-calendar-toolbar">
    <div class="qwb-task-calendar-month-nav">
      <button use:obsidianIcon={"chevron-left"} aria-label="上个月" title="上个月" on:click={() => moveMonth(-1)}></button>
      <h2>{calendarMonthLabel(month)}</h2>
      <button use:obsidianIcon={"chevron-right"} aria-label="下个月" title="下个月" on:click={() => moveMonth(1)}></button>
      <button on:click={() => selectDate(today)}>今天</button>
    </div>
    <label><span>日期依据</span><select bind:value={dateMode}><option value="effective">安排（计划优先）</option><option value="scheduled">计划日期</option><option value="due">截止日期</option></select></label>
    <span class="qwb-task-calendar-summary">{monthCount} 项 · 本月</span>
    {#if undatedCount}<button class="qwb-task-calendar-undated" on:click={onShowUndated}>{undatedCount} 项缺少所选日期 · 去看板</button>{/if}
  </header>
  <div class="qwb-task-calendar-body">
    <section class="qwb-task-calendar-month" aria-label={`${calendarMonthLabel(month)}任务月历`}>
      <div class="qwb-task-calendar-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as weekday}<span>{weekday}</span>{/each}</div>
      <div class="qwb-task-calendar-grid">
        {#each cells as cell (cell.date)}
          {@const entries = groups.get(cell.date) ?? []}
          <section class="qwb-task-calendar-day" class:has-entries={entries.length > 0} class:outside={!cell.inMonth} class:today={cell.isToday} class:selected={cell.date === selected} aria-label={`${cell.date}，${entries.length} 项任务`}>
            <button class="qwb-task-calendar-day-heading" aria-pressed={cell.date === selected} aria-label={`查看 ${cell.date}，${entries.length} 项任务`} on:click={() => showDetail(cell.date)}>
              <time datetime={cell.date}><span class="qwb-task-calendar-numeral">{cell.day}</span><span class="qwb-task-calendar-narrow-date">{calendarDateLabel(cell.date)}</span></time><span>{cell.isToday ? "今天" : entries.length ? `${entries.length} 项` : ""}</span>
            </button>
            <div class="qwb-task-calendar-day-entries">
              {#each entries.slice(0, 3) as entry (entry.task.id)}<TaskCalendarRow {entry} compact {...rowActions} />{/each}
              {#if entries.length > 3}<button class="qwb-task-calendar-more" on:click={() => showDetail(cell.date)}>+{entries.length - 3} 更多</button>{/if}
            </div>
          </section>
        {/each}
      </div>
    </section>
    <section bind:this={detailEl} class="qwb-task-calendar-detail" aria-label="选中日期的任务">
      <header><div><small>当日任务</small><h3>{calendarDateLabel(selected)}</h3></div><span>{detail.length} 项</span></header>
      <div class="qwb-task-calendar-detail-list">
        {#each detail as entry (entry.task.id)}<TaskCalendarRow {entry} {...rowActions} />{:else}<p class="qwb-task-calendar-empty">这一天没有符合筛选条件的任务。</p>{/each}
      </div>
    </section>
  </div>
</main>
