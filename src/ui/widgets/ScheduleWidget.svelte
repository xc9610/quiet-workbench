<script lang="ts">
  import { setIcon } from "obsidian";
  import type { CalendarEntry } from "../../domain/calendar-entries";
  import type { MonthCalendarCell } from "../../domain/calendar";
  import type { AgendaGroup, DayTask } from "./widget-contracts";
  export let mode: "overview" | "month" | "date" = "month";
  export let monthLabel = "";
  export let cells: MonthCalendarCell[] = [];
  export let selected = "";
  export let selectedLabel = "";
  export let emptyDetail = "截止任务";
  export let agenda: AgendaGroup[] = [];
  export let integrationState = "idle";
  export let integrationTitle = "打开 Full Calendar";
  export let dateDay = new Date().getDate();
  export let dateLabel = "";
  export let dayTasks: DayTask[] = [];
  export let entriesForDate: (date: string) => CalendarEntry[] = () => [];
  export let dotClass: (entry: CalendarEntry) => string = () => "task";
  export let onMoveMonth: (offset: number) => void = () => {};
  export let onToday: () => void = () => {};
  export let onSelectDate: (date: string) => void = () => {};
  export let onOpenEntry: (entry: CalendarEntry) => void = () => {};
  export let onOpenPath: (path: string) => void = () => {};
  export let onOpenIntegration: () => void = () => {};

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }
</script>
{#if mode === "overview"}
  <div class="qwb-schedule-overview">
    <header class="qwb-schedule-overview-header">
      <span><strong>未来 7 天</strong><small>计划任务、会议与外部日程</small></span>
      <button use:obsidianIcon={integrationState === "ready" ? "calendar-clock" : "plug-zap"} class:active={integrationState === "ready"} disabled={integrationState === "unavailable"} aria-label={integrationTitle} title={integrationTitle} on:click={onOpenIntegration}></button>
    </header>
    <div class="qwb-schedule-agenda">
      {#each agenda as group (group.date)}
        <section>
          <header><time>{group.label ?? group.date}</time><span>{group.entries.length} 项</span></header>
          <div>
            {#each group.entries as entry (entry.id)}
              <button class:completed={entry.completed} on:click={() => onOpenEntry(entry)}>
                <time>{entry.time || "全天"}</time>
                <i class={dotClass(entry)}></i>
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
{:else if mode === "date"}
  <div class="qwb-calendar-date"><strong>{dateDay}</strong><span>{dateLabel}</span></div>
  <div class="qwb-calendar-lines">
    {#each dayTasks as task}
      <button on:click={() => onOpenPath(task.path)}><time>{task.due}</time><span>{task.text}</span></button>
    {:else}
      <p class="qwb-empty">今天没有已标记日期的任务。</p>
    {/each}
  </div>
{:else}
  <div class="qwb-month-calendar">
    <header class="qwb-month-calendar-toolbar">
      <button use:obsidianIcon={"chevron-left"} aria-label="上个月" title="上个月" on:click={() => onMoveMonth(-1)}></button>
      <strong>{monthLabel}</strong>
      <button class="qwb-calendar-today" on:click={onToday}>今天</button>
      <button use:obsidianIcon={"chevron-right"} aria-label="下个月" title="下个月" on:click={() => onMoveMonth(1)}></button>
    </header>
    <div class="qwb-month-calendar-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as weekday}<span>{weekday}</span>{/each}</div>
    <div class="qwb-month-calendar-grid">
      {#each cells as cell (cell.date)}
        {@const entries = entriesForDate(cell.date)}
        <button class:outside={!cell.inMonth} class:today={cell.isToday} class:selected={selected === cell.date} aria-label={`${cell.date}，${entries.length} 项`} title={`${cell.date} · ${entries.length} 项`} on:click={() => onSelectDate(cell.date)}>
          <time>{cell.day}</time>
          <span class="qwb-calendar-dots">
            {#each entries.slice(0, 3) as entry (entry.id)}<i class={dotClass(entry)}></i>{/each}
            {#if entries.length > 3}<small>{entries.length}</small>{/if}
          </span>
        </button>
      {/each}
    </div>
    {#if selected}
      {@const detail = entriesForDate(selected)}
      <section class="qwb-calendar-detail">
        <header><strong>{selectedLabel}</strong><span>{detail.length} 项</span></header>
        <div>
          {#each detail as entry (entry.id)}
            <button class:overdue={entry.overdue} class:completed={entry.completed} on:click={() => onOpenEntry(entry)}><i class={dotClass(entry)}></i><span><strong>{entry.title}</strong><small>{entry.subtitle}</small></span><em>{entry.kind === "meeting" ? "会议" : entry.completed ? "已完成" : "截止"}</em></button>
          {:else}<p class="qwb-empty">这一天没有{emptyDetail}。</p>{/each}
        </div>
      </section>
    {/if}
  </div>
{/if}
