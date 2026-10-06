<script lang="ts">
  export let kind: "loading" | "empty" | "filtered" | "unavailable" | "error" | "readonly" = "empty";
  export let message = "暂无数据。";
  export let actionLabel = "";
  export let onAction: (() => void) | undefined = undefined;
</script>
<div class="qwb-widget-state" class:is-error={kind === "error"} role={kind === "error" ? "alert" : "status"}>
  <p class="qwb-empty">{message}</p>
  {#if actionLabel && onAction}<button type="button" class="qwb-text-action" on:click={onAction}>{actionLabel}</button>{/if}
</div>
