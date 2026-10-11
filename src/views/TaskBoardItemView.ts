import { ItemView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { mount, unmount } from "svelte";
import type { WorkbenchController } from "../ui/controller";
import TaskBoardView from "./TaskBoardView.svelte";

export const TASK_BOARD_VIEW_TYPE = "quiet-workbench-task-board";

export class TaskBoardItemView extends ItemView {
  private component?: { selectView: (view: "board" | "calendar") => void };
  private taskView: "board" | "calendar" = "board";

  constructor(leaf: WorkspaceLeaf, private readonly controller: WorkbenchController) {
    super(leaf);
  }

  getViewType(): string {
    return TASK_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Asterism 任务";
  }

  getIcon(): string {
    return "list-todo";
  }

  usesController(controller: WorkbenchController): boolean {
    return this.controller === controller;
  }

  getState(): Record<string, unknown> {
    return { view: this.taskView };
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    if (state.view === "board" || state.view === "calendar") this.selectTaskView(state.view);
    await super.setState(state, result);
  }

  selectTaskView(view: "board" | "calendar"): void {
    this.taskView = view;
    const selectView = this.component?.selectView;
    if (typeof selectView === "function") selectView(view);
    this.app.workspace.requestSaveLayout();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("quiet-workbench-task-board-host");
    const component: unknown = mount(TaskBoardView, {
      target: this.contentEl,
      props: {
        controller: this.controller,
        initialView: this.taskView,
        onViewChange: (view: "board" | "calendar") => {
          if (this.taskView === view) return;
          this.taskView = view;
          this.app.workspace.requestSaveLayout();
        }
      }
    });
    this.component = component as { selectView: (view: "board" | "calendar") => void };
    await (this.controller.refreshOnOpen?.() ?? this.controller.refresh());
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = undefined;
    this.contentEl.removeClass("quiet-workbench-task-board-host");
  }
}
