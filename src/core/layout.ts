import type { LayoutItem, LayoutSchema, WorkbenchSurface } from "./types";
import type { WidgetRegistry } from "./widget-registry";

export interface LayoutValidationIssue {
  path: string;
  message: string;
}

export type LayoutValidationResult =
  | { valid: true; layout: LayoutSchema; issues: [] }
  | { valid: false; issues: LayoutValidationIssue[] };

export type LayoutDevice = "desktop" | "mobile";

const layouts: LayoutSchema[] = [
  {
    version: 1,
    id: "today",
    name: "今日执行",
    surface: "workbench",
    items: [
      { widgetId: "tasks.today", x: 0, y: 0, width: 6, height: 5 },
      { widgetId: "core.calendar", x: 6, y: 0, width: 3, height: 5 },
      { widgetId: "core.quick-create", x: 9, y: 0, width: 3, height: 2 },
      { widgetId: "projects.recent", x: 9, y: 2, width: 3, height: 3 }
    ]
  },
  {
    version: 1,
    id: "projects",
    name: "项目管理",
    surface: "workbench",
    items: [
      { widgetId: "projects.status", x: 0, y: 0, width: 4, height: 4 },
      { widgetId: "projects.milestones", x: 4, y: 0, width: 4, height: 4 },
      { widgetId: "tasks.project", x: 8, y: 0, width: 4, height: 4 },
      { widgetId: "clients.list", x: 0, y: 4, width: 6, height: 4 },
      { widgetId: "suppliers.list", x: 6, y: 4, width: 6, height: 4 },
      { widgetId: "meetings.actions", x: 0, y: 8, width: 12, height: 4 }
    ]
  },
  {
    version: 1,
    id: "knowledge",
    name: "知识整理",
    surface: "workbench",
    items: [
      { widgetId: "knowledge.inbox", x: 0, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.triage", x: 4, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.project-links", x: 8, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.recent", x: 0, y: 4, width: 12, height: 4 }
    ]
  },
  {
    version: 1,
    id: "sidebar-default",
    name: "上下文侧栏",
    surface: "sidebar",
    items: [
      { widgetId: "core.context", x: 0, y: 0, width: 1, height: 3 },
      { widgetId: "tasks.context", x: 0, y: 3, width: 1, height: 4 },
      { widgetId: "projects.context", x: 0, y: 7, width: 1, height: 3 },
      { widgetId: "meetings.context", x: 0, y: 10, width: 1, height: 3 },
      { widgetId: "core.quick-create", x: 0, y: 13, width: 1, height: 2 }
    ]
  }
];

export const DEFAULT_LAYOUTS: ReadonlyArray<Readonly<LayoutSchema>> = Object.freeze(
  layouts.map((layout) => deepFreezeLayout(layout))
);

export function cloneLayout(layout: LayoutSchema): LayoutSchema {
  return {
    ...layout,
    items: layout.items.map((item) => ({
      ...item,
      config: item.config ? { ...item.config } : undefined
    }))
  };
}

export function getDefaultLayouts(): LayoutSchema[] {
  return layouts.map(cloneLayout);
}

export function validateLayout(
  value: unknown,
  registry: WidgetRegistry
): LayoutValidationResult {
  const issues: LayoutValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: "$", message: "Layout must be an object" }] };
  }

  if (value.version !== 1) {
    issues.push({ path: "version", message: "Only layout version 1 is supported" });
  }
  validateString(value.id, "id", issues, /^[a-z0-9][a-z0-9-]*$/);
  validateString(value.name, "name", issues);
  if (value.surface !== "workbench" && value.surface !== "sidebar") {
    issues.push({ path: "surface", message: "Surface must be workbench or sidebar" });
  }
  if (!Array.isArray(value.items)) {
    issues.push({ path: "items", message: "Items must be an array" });
  } else {
    const widgetIds = new Set<string>();
    value.items.forEach((raw, index) => {
      const path = `items[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: "Item must be an object" });
        return;
      }
      validateString(raw.widgetId, `${path}.widgetId`, issues);
      for (const key of ["x", "y", "width", "height"] as const) {
        const field = raw[key];
        if (!Number.isInteger(field) || (key.startsWith("w") || key.startsWith("h") ? Number(field) <= 0 : Number(field) < 0)) {
          issues.push({ path: `${path}.${key}`, message: `${key} must be a valid integer` });
        }
      }
      for (const key of ["hidden", "collapsed"] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
          issues.push({ path: `${path}.${key}`, message: `${key} must be a boolean` });
        }
      }
      if (
        value.surface === "workbench" &&
        Number.isInteger(raw.x) &&
        Number.isInteger(raw.width) &&
        Number(raw.x) + Number(raw.width) > 12
      ) {
        issues.push({ path, message: "Workbench items must fit within the 12-column grid" });
      }
      if (
        value.surface === "sidebar" &&
        (raw.x !== 0 || raw.width !== 1)
      ) {
        issues.push({ path, message: "Sidebar items must use the single-column grid" });
      }
      if (typeof raw.widgetId === "string") {
        if (widgetIds.has(raw.widgetId)) {
          issues.push({ path: `${path}.widgetId`, message: "A widget may appear only once per layout" });
        }
        widgetIds.add(raw.widgetId);
        const definition = registry.get(raw.widgetId);
        if (!definition) {
          issues.push({ path: `${path}.widgetId`, message: `Unknown widget: ${raw.widgetId}` });
        } else if (
          (value.surface === "workbench" || value.surface === "sidebar") &&
          !definition.surfaces.includes(value.surface)
        ) {
          issues.push({ path: `${path}.widgetId`, message: `Widget does not support ${value.surface}` });
        }
        if (raw.config !== undefined && !isRecord(raw.config)) {
          issues.push({ path: `${path}.config`, message: "Config must be an object" });
        } else if (isRecord(raw.config)) {
          for (const issue of registry.validateConfig(raw.widgetId, raw.config)) {
            issues.push({ path: `${path}.config.${issue.path}`, message: issue.message });
          }
        }
      }
    });
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }
  return { valid: true, layout: cloneLayout(value as unknown as LayoutSchema), issues: [] };
}

export function importLayout(
  input: unknown,
  registry: WidgetRegistry
): LayoutValidationResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { valid: false, issues: [{ path: "$", message: "Invalid JSON" }] };
    }
  }
  return validateLayout(value, registry);
}

export function adaptLayoutForDevice(
  layout: LayoutSchema,
  device: LayoutDevice
): LayoutSchema {
  if (device === "desktop") {
    return cloneLayout(layout);
  }
  const ordered = layout.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index);
  let y = 0;
  return {
    ...layout,
    items: ordered.map(({ item }) => {
      const result: LayoutItem = {
        ...item,
        x: 0,
        y,
        width: 1,
        config: item.config ? { ...item.config } : undefined
      };
      y += item.collapsed ? 1 : Math.max(1, item.height);
      return result;
    })
  };
}

export function updateLayoutItem(
  layout: LayoutSchema,
  widgetId: string,
  patch: Partial<Omit<LayoutItem, "widgetId">>
): LayoutSchema {
  let found = false;
  const updated = cloneLayout(layout);
  updated.items = updated.items.map((item) => {
    if (item.widgetId !== widgetId) return item;
    found = true;
    return {
      ...item,
      ...patch,
      widgetId,
      config: patch.config ? { ...patch.config } : item.config
    };
  });
  if (!found) throw new Error(`Widget is not in layout: ${widgetId}`);
  return updated;
}

/** Returns a mobile projection; it does not overwrite the desktop coordinates. */
export function reorderMobileLayout(
  layout: LayoutSchema,
  orderedWidgetIds: string[]
): LayoutSchema {
  const existing = new Set(layout.items.map((item) => item.widgetId));
  if (
    orderedWidgetIds.length !== existing.size ||
    new Set(orderedWidgetIds).size !== existing.size ||
    orderedWidgetIds.some((id) => !existing.has(id))
  ) {
    throw new Error("Mobile order must contain every layout widget exactly once");
  }
  const byId = new Map(layout.items.map((item) => [item.widgetId, item]));
  const reordered = cloneLayout(layout);
  let y = 0;
  reordered.items = orderedWidgetIds.map((id) => {
    const item = byId.get(id)!;
    const next = { ...item, x: 0, y, width: 1, config: item.config ? { ...item.config } : undefined };
    y += item.collapsed ? 1 : Math.max(1, item.height);
    return next;
  });
  return reordered;
}

export class LayoutManager {
  private readonly layouts = new Map<string, LayoutSchema>();

  constructor(private readonly registry: WidgetRegistry, initial: LayoutSchema[] = []) {
    for (const layout of [...getDefaultLayouts(), ...initial]) {
      this.save(layout, true);
    }
  }

  list(surface?: WorkbenchSurface): LayoutSchema[] {
    return [...this.layouts.values()]
      .filter((layout) => !surface || layout.surface === surface)
      .map(cloneLayout);
  }

  get(id: string): LayoutSchema | undefined {
    const layout = this.layouts.get(id);
    return layout ? cloneLayout(layout) : undefined;
  }

  import(input: unknown): LayoutSchema {
    const result = importLayout(input, this.registry);
    if (!result.valid) {
      throw new LayoutValidationError(result.issues);
    }
    return this.save(result.layout);
  }

  save(layout: LayoutSchema, replace = false): LayoutSchema {
    const result = validateLayout(layout, this.registry);
    if (!result.valid) {
      throw new LayoutValidationError(result.issues);
    }
    if (!replace && this.layouts.has(layout.id)) {
      throw new Error(`Layout already exists: ${layout.id}`);
    }
    const copy = cloneLayout(result.layout);
    this.layouts.set(copy.id, copy);
    return cloneLayout(copy);
  }

  copy(sourceId: string, id: string, name: string): LayoutSchema {
    const source = this.require(sourceId);
    return this.save({ ...source, id, name });
  }

  rename(id: string, name: string): LayoutSchema {
    if (!name.trim()) {
      throw new Error("Layout name is required");
    }
    const current = this.require(id);
    return this.save({ ...current, name: name.trim() }, true);
  }

  updateItem(
    id: string,
    widgetId: string,
    patch: Partial<Omit<LayoutItem, "widgetId">>
  ): LayoutSchema {
    return this.save(updateLayoutItem(this.require(id), widgetId, patch), true);
  }

  restoreDefault(id: string): LayoutSchema {
    const original = layouts.find((layout) => layout.id === id);
    if (!original) {
      throw new Error(`No default layout: ${id}`);
    }
    return this.save(cloneLayout(original), true);
  }

  remove(id: string): boolean {
    return this.layouts.delete(id);
  }

  private require(id: string): LayoutSchema {
    const layout = this.get(id);
    if (!layout) {
      throw new Error(`Unknown layout: ${id}`);
    }
    return layout;
  }
}

export class LayoutValidationError extends Error {
  constructor(public readonly issues: LayoutValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "LayoutValidationError";
  }
}

function deepFreezeLayout(layout: LayoutSchema): Readonly<LayoutSchema> {
  layout.items.forEach((item) => {
    if (item.config) Object.freeze(item.config);
    Object.freeze(item);
  });
  Object.freeze(layout.items);
  return Object.freeze(layout);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(
  value: unknown,
  path: string,
  issues: LayoutValidationIssue[],
  pattern?: RegExp
): void {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ path, message: "A non-empty string is required" });
  } else if (pattern && !pattern.test(value)) {
    issues.push({ path, message: "Invalid value" });
  }
}
