import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import ContextPanel from "./ContextPanel.svelte";
import type { WorkbenchController } from "../ui/controller";

export const CONTEXT_PANEL_VIEW_TYPE = "quiet-workbench-context-panel";

export class ContextPanelView extends ItemView {
  private component?: ReturnType<typeof mount>;

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return CONTEXT_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Asterism 上下文";
  }

  getIcon(): string {
    return "panel-right";
  }

  usesController(controller: WorkbenchController): boolean {
    return this.controller === controller;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("quiet-workbench-context-host");
    this.component = mount(ContextPanel, {
      target: this.contentEl,
      props: { controller: this.controller }
    });
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("quiet-workbench-context-host");
  }
}
