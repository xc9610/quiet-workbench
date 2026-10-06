<script lang="ts">
  import { formatDate } from "../../services/template-service";
  import type { MemoRecentEntry } from "./widget-contracts";
  export let draft = "";
  export let writesEnabled = false;
  export let busy = false;
  export let path = "";
  export let exists = false;
  export let error = "";
  export let recent: MemoRecentEntry[] = [];
  export let onInput: (value: string) => void;
  export let onKeydown: (event: KeyboardEvent) => void;
  export let onSubmit: () => void;
  export let onOpenFile: () => void;
  export let onYolo: () => void;
  export let registerTextarea: (node: HTMLTextAreaElement) => void = () => {};

  const today = () => formatDate(new Date(), "YYYY-MM-DD");
  function attachTextarea(node: HTMLTextAreaElement) {
    registerTextarea(node);
    return { destroy() {} };
  }
</script>
<div class="qwb-memo-compose">
  <textarea use:attachTextarea value={draft} rows="3" placeholder="记下一条；时间会自动添加。" on:input={(event) => onInput(event.currentTarget.value)} on:keydown={onKeydown}></textarea>
  <div><small>Enter 记录 · Shift + Enter 换行</small><button disabled={!writesEnabled || !draft.trim() || busy} on:click={onSubmit}>记录一条</button><button disabled={!exists} title={path || "尚未创建速记文件"} on:click={onOpenFile}>打开文件</button><button disabled={!exists} on:click={onYolo}>YOLO 整理今日</button></div>
</div>
{#if error}<p class="qwb-inline-error">{error}</p>{/if}
<div class="qwb-memo-recent">
  {#each recent as entry}<button on:click={onOpenFile}><time>{entry.time || "—"}</time><span>{entry.text}</span><small>{entry.date === today() ? "今天" : entry.date}</small></button>{:else}<p class="qwb-empty">尚无速记。首次记录会创建配置的速记文件。</p>{/each}
</div>
