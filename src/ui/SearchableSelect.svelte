<script lang="ts">
  import { filterSearchableOptions, type SearchableOption } from "./searchable-select";

  export let id: string;
  export let label: string;
  export let value = "";
  export let options: readonly SearchableOption[] = [];
  export let placeholder = "输入名称搜索";
  export let emptyLabel = "暂不关联";
  export let help = "输入关键词后，从候选结果中确认关联。";
  export let onSelect: (value: string) => void = () => undefined;

  let root: HTMLDivElement;
  let query = "";
  let expanded = false;
  let activeIndex = 0;
  let lastSyncedValue: string | undefined;

  $: selected = options.find((option) => option.value === value);
  $: if (!expanded && value !== lastSyncedValue) {
    query = selected?.label ?? (value ? value : "");
    lastSyncedValue = value;
  }
  $: filtered = filterSearchableOptions(options, query);
  $: if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1);

  function updateValue(next: string): void {
    value = next;
    lastSyncedValue = next;
    onSelect(next);
  }

  function choose(option: SearchableOption): void {
    updateValue(option.value);
    query = option.label;
    expanded = false;
  }

  function clear(): void {
    updateValue("");
    query = "";
    activeIndex = 0;
    expanded = true;
  }

  function handleInput(): void {
    if (selected?.label !== query) updateValue("");
    activeIndex = 0;
    expanded = true;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      expanded = true;
      activeIndex = Math.min(activeIndex + 1, Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      expanded = true;
      activeIndex = Math.max(0, activeIndex - 1);
      return;
    }
    if (event.key === "Enter" && expanded && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      query = selected?.label ?? "";
      expanded = false;
    }
  }

  function handleFocusOut(event: FocusEvent): void {
    if (root?.contains(event.relatedTarget as Node | null)) return;
    const exact = options.find((option) => option.label.localeCompare(query, "zh-CN", { sensitivity: "accent" }) === 0);
    if (exact) choose(exact);
    else query = selected?.label ?? "";
    expanded = false;
  }
</script>

<div class="searchable-field" bind:this={root} on:focusout={handleFocusOut}>
  <label for={id}>{label}</label>
  <div class="search-control">
    <input
      {id}
      bind:value={query}
      type="search"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={`${id}-options`}
      aria-activedescendant={expanded && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      {placeholder}
      on:focus={() => (expanded = true)}
      on:input={handleInput}
      on:keydown={handleKeydown}
    />
    {#if value || query}
      <button type="button" class="clear" aria-label={`清除${label}`} title={`清除${label}`} on:click={clear}>清除</button>
    {/if}
  </div>
  {#if expanded}
    <div id={`${id}-options`} class="option-list" role="listbox" aria-label={`${label}候选项`}>
      <button
        type="button"
        role="option"
        aria-selected={!value}
        on:click={() => { updateValue(""); query = ""; expanded = false; }}
      >
        <span><strong>{emptyLabel}</strong><small>不写入关联字段</small></span>
      </button>
      {#each filtered as option, index (option.value)}
        <button
          id={`${id}-option-${index}`}
          type="button"
          role="option"
          aria-selected={value === option.value}
          class:active={index === activeIndex}
          on:mouseenter={() => (activeIndex = index)}
          on:click={() => choose(option)}
        >
          <span><strong>{option.label}</strong>{#if option.description}<small>{option.description}</small>{/if}</span>
          {#if value === option.value}<em>已选择</em>{/if}
        </button>
      {:else}
        <p>没有匹配项，请换一个关键词。</p>
      {/each}
      {#if filtered.length < options.length}<footer>显示前 {filtered.length} 项，继续输入可缩小范围。</footer>{/if}
    </div>
  {/if}
  {#if help}<small class="help">{help}</small>{/if}
</div>

<style>
  .searchable-field { display: grid; gap: 6px; margin-bottom: 13px; color: var(--text-muted); font-size: 11px; font-weight: 600; }
  .search-control { position: relative; }
  input { width: 100%; min-height: 38px; padding-right: 58px; color: var(--text-normal); font-size: 12px; }
  .clear { position: absolute; top: 50%; right: 6px; min-height: 28px; padding: 0 7px; transform: translateY(-50%); border: 0; background: transparent; box-shadow: none; color: var(--text-muted); font-size: 10px; }
  .clear:hover, .clear:focus-visible { background: var(--background-modifier-hover); color: var(--text-normal); }
  .option-list { display: grid; max-height: 240px; overflow: auto; padding: 5px; border: 1px solid var(--background-modifier-border); border-radius: 9px; background: var(--background-secondary); box-shadow: var(--shadow-s); }
  .option-list button { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 44px; padding: 7px 9px; border: 0; border-radius: 7px; background: transparent; box-shadow: none; color: var(--text-normal); text-align: left; }
  .option-list button:hover, .option-list button.active, .option-list button:focus-visible { background: var(--background-modifier-hover); }
  .option-list button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
  .option-list span { display: grid; min-width: 0; gap: 2px; }
  .option-list strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .option-list small, .option-list footer, .option-list p, .help { color: var(--text-faint); font-size: 10px; font-weight: 450; }
  .option-list em { color: var(--text-accent); font-size: 10px; font-style: normal; white-space: nowrap; }
  .option-list p, .option-list footer { margin: 0; padding: 9px; }
  .option-list footer { border-top: 1px solid var(--background-modifier-border); }
</style>
