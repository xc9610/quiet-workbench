import { ViewRefreshState } from "../core/view-refresh-state";
import type { WorkbenchController, WorkbenchSnapshot } from "./controller";

/** Visibility belongs to the host, data freshness belongs to the controller. */
export function subscribeVisible(
  controller: WorkbenchController,
  host: HTMLElement,
  publish: (snapshot: WorkbenchSnapshot) => void,
  editing: () => boolean = () => false
): { dispose(): void; flush(): void } {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) return { dispose() {}, flush() {} };
  const state = new ViewRefreshState(publish);
  let wasVisible = false;
  const visible = () => !doc.hidden && host.getClientRects().length > 0 && host.clientWidth > 0 && host.clientHeight > 0;
  const flush = () => {
    const shown = visible();
    state.flush(shown, editing());
    if (shown && !wasVisible) void controller.refreshVisible?.().catch(() => undefined);
    wasVisible = shown;
  };
  const off = controller.subscribe((value) => { state.offer(value, visible(), editing()); });
  const intersection = new win.IntersectionObserver(flush);
  const resize = new win.ResizeObserver(flush);
  intersection.observe(host);
  resize.observe(host);
  doc.addEventListener("visibilitychange", flush);
  flush();
  return {
    flush,
    dispose() {
      state.dispose(); off(); intersection.disconnect(); resize.disconnect();
      doc.removeEventListener("visibilitychange", flush);
    }
  };
}
