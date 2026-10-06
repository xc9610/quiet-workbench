<script lang="ts">
  export let title: string;
  export let name: string;
  export let cols: number;
  export let rows: number;
  export let onCancel: () => void;
  export let onSave: () => void;
  export let onRemove: () => void;
  export let focusDialog: (node: HTMLElement) => { destroy(): void };
</script>
<div class="qwb-modal-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && onCancel()}>
  <div class="qwb-modal qwb-widget-settings" use:focusDialog role="dialog" aria-modal="true" aria-labelledby="qwb-widget-settings-title">
    <header><div><span class="qwb-eyebrow">WIDGET INSTANCE</span><h2 id="qwb-widget-settings-title">{title}设置</h2></div><button aria-label="关闭" on:click={onCancel}>×</button></header>
    <div class="qwb-modal-body qwb-dialog-form">
      <label>组件名称<input bind:value={name} placeholder="例如：客户 A 待跟进" /></label>
      <fieldset class="qwb-widget-size-editor"><legend>组件尺寸</legend>
        <label>宽度<select bind:value={cols}><option value={1}>窄 · 1 列</option><option value={2}>标准 · 2 列</option><option value={3}>宽 · 3 列</option><option value={4}>整行 · 4 列</option></select></label>
        <label>高度<select bind:value={rows}>{#each [1, 2, 3, 4, 5, 6, 7, 8] as row}<option value={row}>{row === 1 ? "紧凑" : row === 2 ? "标准" : `${row} 行`}</option>{/each}</select></label>
        <small>布局按阅读顺序自动排列，不再需要拖到精确坐标。</small>
      </fieldset>
      <slot />
      <div class="qwb-modal-actions"><button class="qwb-button qwb-danger-button" on:click={onRemove}>移除组件</button><span></span><button class="qwb-button qwb-button-subtle" on:click={onCancel}>取消</button><button class="qwb-button qwb-button-primary" on:click={onSave}>保存</button></div>
    </div>
  </div>
</div>
