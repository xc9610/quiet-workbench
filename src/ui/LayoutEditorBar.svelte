<script lang="ts">
  export let dirty = false;
  export let canUndo = false;
  export let busy = false;
  export let onAdd: () => void;
  export let onUndo: () => void;
  export let onRestore: () => void;
  export let onExport: () => void;
  export let onCancel: () => void;
  export let onSave: () => void;
</script>

<div class="qwb-layout-actions" aria-label="布局操作">
  <span><strong>编辑布局</strong><small>{dirty ? "有未保存调整" : "尚未修改"}</small></span>
  <button class="qwb-add-widget" disabled={busy} on:click={onAdd}>＋ 添加组件</button>
  <button disabled={!canUndo || busy} on:click={onUndo}>撤销布局</button>
  <button disabled={busy} on:click={onRestore}>恢复默认</button>
  <button disabled={busy} on:click={onExport}>导出</button>
  <span class="qwb-layout-actions-spacer"></span>
  <button disabled={busy} on:click={onCancel}>取消</button>
  <button class="qwb-layout-save" disabled={busy || !dirty} on:click={onSave}>保存布局</button>
</div>
