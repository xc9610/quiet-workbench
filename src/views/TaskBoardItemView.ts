import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { WorkbenchController } from "../ui/controller";
import TaskBoardView from "./TaskBoardView.svelte";

export const TASK_BOARD_VIEW_TYPE = "quiet-workbench-task-board";

export class TaskBoardItemView extends ItemView {
  private component?: ReturnType<typeof mount>;

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return TASK_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Quiet Workbench 任务看板";
  }

  getIcon(): string {
    return "list-todo";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("quiet-workbench-task-board-host");
    this.component = mount(TaskBoardView, {
      target: this.contentEl,
      props: { controller: this.controller }
    });
    await this.controller.refresh();
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("quiet-workbench-task-board-host");
  }
}
