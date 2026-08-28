import type { ContextSurface, EntityKind, SidebarProfileId } from "./types";

export interface SidebarContextDescriptor {
  surface: ContextSurface;
  kind?: EntityKind;
}

export function resolveSidebarProfile(context: SidebarContextDescriptor): SidebarProfileId {
  if (context.surface === "workbench") return "workbench";
  if (context.surface === "task-board") return "task-board";
  if (context.kind === "project") return "project";
  if (context.kind === "client") return "client";
  if (context.kind === "supplier") return "supplier";
  if (context.kind === "meeting") return "meeting";
  if (context.kind === "knowledge") return "knowledge";
  return "note";
}

export function sidebarTaskSource<T>(
  context: SidebarContextDescriptor,
  contextualTasks: readonly T[],
  globalTasks: readonly T[]
): readonly T[] {
  return context.kind ? contextualTasks : globalTasks;
}

export const SIDEBAR_PROFILE_NAMES: Readonly<Record<SidebarProfileId, string>> = Object.freeze({
  workbench: "工作台",
  "task-board": "任务看板",
  project: "项目笔记",
  client: "客户笔记",
  supplier: "供应商笔记",
  meeting: "会议笔记",
  knowledge: "知识笔记",
  note: "普通笔记"
});

export const DEFAULT_SIDEBAR_PROFILES: Readonly<Record<SidebarProfileId, string>> = Object.freeze({
  workbench: "sidebar-workbench",
  "task-board": "sidebar-task-board",
  project: "sidebar-project",
  client: "sidebar-client",
  supplier: "sidebar-supplier",
  meeting: "sidebar-meeting",
  knowledge: "sidebar-knowledge",
  note: "sidebar-default"
});
