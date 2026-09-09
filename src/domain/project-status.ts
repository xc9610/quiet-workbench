/** Presentation-only normalization: historical frontmatter is never rewritten. */
export function projectStatusLabel(status?: string): string {
  const value = (status ?? "").trim();
  const key = value.toLowerCase();
  if (["推进中", "进行中", "跟进中", "进", "active", "in progress"].includes(key)) return "推进中";
  if (["暂停", "暂缓", "paused", "on hold"].includes(key)) return "暂停";
  if (["归档", "已归档", "停止", "archived"].includes(key)) return "归档";
  if (["完成", "已完成", "已关闭", "closed", "done", "completed"].includes(key)) return "已完成";
  return value || "未设置";
}

export function isClosedProjectStatus(status?: string): boolean {
  return ["归档", "已完成"].includes(projectStatusLabel(status));
}
