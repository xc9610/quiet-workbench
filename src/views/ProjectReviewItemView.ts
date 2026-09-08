import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { WorkbenchController } from "../ui/controller";
import ProjectReviewView from "./ProjectReviewView.svelte";

export const PROJECT_REVIEW_VIEW_TYPE = "asterism-project-review";

export class ProjectReviewItemView extends ItemView {
  private component?: ReturnType<typeof mount>;

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return PROJECT_REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Asterism 项目审阅";
  }

  getIcon(): string {
    return "clipboard-check";
  }

  usesController(controller: WorkbenchController): boolean {
    return this.controller === controller;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("asterism-project-review-host");
    this.component = mount(ProjectReviewView, {
      target: this.contentEl,
      props: { controller: this.controller }
    });
    await this.controller.refresh();
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("asterism-project-review-host");
  }
}
