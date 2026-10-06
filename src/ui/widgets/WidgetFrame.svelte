<script lang="ts">
  import WidgetState from "./WidgetState.svelte";
  export let instanceId: string;
  export let title: string;
  export let collapsed = false;
  export let editing = false;
  export let order = 0;
  export let style = "";
</script>
<section data-instance-id={instanceId} class:collapsed class:editing class="qwb-widget" {style}>
  <header class="qwb-widget-header">
    {#if editing}<span class="qwb-layout-order" aria-label={`布局顺序 ${order}`}>{order}</span>{/if}
    <h2>{title}</h2>
    <slot name="actions" />
  </header>
  {#if !collapsed}
    <div class="qwb-widget-body">
      <svelte:boundary>
        <slot />
        {#snippet failed(error, reset)}
          <WidgetState kind="error" message={`组件暂不可用：${error instanceof Error ? error.message : String(error)}`} actionLabel="重试组件" onAction={reset} />
        {/snippet}
      </svelte:boundary>
    </div>
  {/if}
</section>
