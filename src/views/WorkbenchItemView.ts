import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import WorkbenchView from "./WorkbenchView.svelte";
import type { WorkbenchController } from "../ui/controller";

export const WORKBENCH_VIEW_TYPE = "quiet-workbench-view";

export class WorkbenchItemView extends ItemView {
  private component?: ReturnType<typeof mount>;

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Quiet Workbench";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  usesController(controller: WorkbenchController): boolean {
    return this.controller === controller;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("quiet-workbench-host");
    this.component = mount(WorkbenchView, {
      target: this.contentEl,
      props: { controller: this.controller }
    });
    await this.controller.refresh();
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("quiet-workbench-host");
  }
}
