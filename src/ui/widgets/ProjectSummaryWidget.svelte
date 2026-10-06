<script lang="ts">
  import type { SummaryModel } from "./widget-contracts";
  export let model: SummaryModel | null = null;
  export let emptyMessage = "请选择或配置一个项目。";
  export let onOpen: () => void = () => {};
  export let onYolo: () => void = () => {};
  export let onShare: () => void = () => {};
  export let onAnimalChange: (value: string) => void = () => {};
</script>
{#if model}
  <div class="qwb-project-summary" class:qwb-client-summary={model.iconKind === "client"}>
    <button class="qwb-summary-title" on:click={onOpen}>
      <span class="qwb-entity-icon {model.iconKind}">{model.iconText}</span>
      <span><strong>{model.name}</strong><small>{model.subtitle}</small></span>
      <em>{model.badge}</em>
    </button>
    <dl>{#each model.fields as field}<div><dt>{field.label}</dt><dd>{field.value}</dd></div>{/each}</dl>
    {#if model.noteText !== undefined}<div class="qwb-project-next"><small>{model.noteLabel}</small><p>{model.noteText}</p></div>{/if}
    <div class="qwb-summary-actions">
      {#if model.animal}<label class="qwb-project-animal-picker">项目动物 <select aria-label="选择项目动物" value={model.animal.value} on:change={(event) => onAnimalChange(event.currentTarget.value)}><option value="">不设置</option>{#each model.animal.options as animal}<option value={animal.id}>{animal.emoji} {animal.label}</option>{/each}</select></label>{/if}
      <button disabled={model.shared} on:click={onShare}>{model.shared ? model.sharedLabel ?? model.shareLabel : model.shareLabel}</button>
      <button on:click={onOpen}>{model.openLabel}</button>
      <button on:click={onYolo}>YOLO</button>
    </div>
  </div>
{:else}
  <p class="qwb-empty">{emptyMessage}</p>
{/if}
