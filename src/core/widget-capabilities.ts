export type WidgetDependency = "entities" | "tasks" | "memo" | "activity" | "calendar" | "diagnostics" | "context";
export function widgetCapabilities(id: string) {
  if (id === "capture.memo" || id === "core.quick-memo") return { dependencies: ["memo"] as WidgetDependency[], configurableSource: false };
  if (id === "view.heatmap" || id === "core.activity-heatmap") return { dependencies: ["activity"] as WidgetDependency[], configurableSource: false };
  if (id === "core.diagnostics") return { dependencies: ["diagnostics"] as WidgetDependency[], configurableSource: false };
  return {
    dependencies: ["entities", "tasks", "context", ...(id.includes("calendar") ? ["calendar" as const] : [])] as WidgetDependency[],
    configurableSource: /^(view|control|tasks|projects)\./u.test(id)
  };
}
export function sourceFilterFields(source: string): ReadonlySet<string> {
  return new Set(source === "tasks" ? ["client", "projectType", "taskScopes", "includeCompleted"]
    : source === "projects" ? ["client", "projectType"]
    : source === "clients" ? ["relationshipStatus", "organizationType"]
    : source === "meetings" || source === "knowledge" ? ["client"] : []);
}
