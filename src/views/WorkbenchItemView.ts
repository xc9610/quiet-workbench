import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import WorkbenchView from "./WorkbenchView.svelte";
import type { WorkbenchController } from "../ui/controller";

export const WORKBENCH_VIEW_TYPE = "quiet-workbench-view";

export class WorkbenchItemView extends ItemView {
  private component?: ReturnType<typeof mount>;
  private openGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Asterism 工作台";
  }

  getIcon(): string {
    return "asterism-mark";
  }

  usesController(controller: WorkbenchController): boolean {
    return this.controller === controller;
  }

  async onOpen(): Promise<void> {
    const generation = ++this.openGeneration;
    this.contentEl.empty();
    this.contentEl.addClass("quiet-workbench-host");
    this.renderLoading();
    try {
      this.contentEl.empty();
      this.component = mount(WorkbenchView, {
        target: this.contentEl,
        props: { controller: this.controller }
      });
    } catch (error) {
      this.renderFailure("工作台界面未能加载", error, true);
      return;
    }

    try {
      await this.controller.refresh();
    } catch (error) {
      if (generation === this.openGeneration) this.renderFailure("数据刷新失败，当前显示的是上次缓存", error, false);
    }
  }

  async onClose(): Promise<void> {
    this.openGeneration += 1;
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("quiet-workbench-host");
  }

  private renderLoading(): void {
    const state = this.contentEl.createDiv({ cls: "qwb-view-state qwb-view-loading" });
    state.createDiv({ cls: "qwb-view-state-mark", text: "✦" });
    const copy = state.createDiv();
    copy.createEl("strong", { text: "正在打开 Asterism" });
    copy.createSpan({ text: "正在恢复布局并读取本地索引…" });
  }

  private renderFailure(title: string, error: unknown, fatal: boolean): void {
    if (fatal) {
      this.contentEl.empty();
      this.component = undefined;
    } else {
      this.contentEl.querySelector(".qwb-view-recovery")?.remove();
    }
    const state = this.contentEl.createDiv({ cls: `qwb-view-state qwb-view-recovery${fatal ? " is-fatal" : ""}` });
    if (!fatal) this.contentEl.prepend(state);
    state.createDiv({ cls: "qwb-view-state-mark", text: "!" });
    const copy = state.createDiv();
    copy.createEl("strong", { text: title });
    copy.createSpan({ text: error instanceof Error ? error.message : String(error) });
    const retry = state.createEl("button", { text: fatal ? "重新打开" : "重新刷新" });
    retry.addEventListener("click", () => {
      retry.disabled = true;
      if (fatal) {
        void this.onOpen();
        return;
      }
      void this.controller.refresh()
        .then(() => state.remove())
        .catch((nextError) => {
          copy.querySelector("span")?.setText(nextError instanceof Error ? nextError.message : String(nextError));
          retry.disabled = false;
        });
    });
  }
}
