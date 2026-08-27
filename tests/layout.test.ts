import { describe, expect, it } from "vitest";
import {
  adaptLayoutForDevice,
  ensureSingleWorkbenchLayout,
  getDefaultLayouts,
  importLayout,
  LayoutManager,
  reorderMobileLayout,
  upgradePersistedLayouts,
  updateLayoutItem,
  validateLayout
} from "../src/core/layout";
import {
  createBuiltinWidgetRegistry,
  WidgetRegistry
} from "../src/core/widget-registry";
import {
  computeOrderedGridColumns,
  migrateLayoutToOrderedGrid,
  normalizeOrderedItems
} from "../src/core/ordered-grid";

describe("Xove-compatible ordered grid", () => {
  it("migrates absolute positions into stable reading order and card spans", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    layout.items = [layout.items[3], layout.items[1], layout.items[0], layout.items[2]];
    const migrated = migrateLayoutToOrderedGrid(layout);

    expect(migrated.items.map((item) => item.presetId ?? item.widgetId)).toEqual([
      "tasks.today-focus",
      "capture.memo",
      "core.quick-create",
      "projects.recent"
    ]);
    expect(migrated.items.map((item) => [item.cols, item.rows])).toEqual([
      [3, 2],
      [2, 1],
      [2, 1],
      [2, 1]
    ]);
    expect(migrated.items.map((item) => [item.x, item.y])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
  });

  it("normalizes reordered cards without changing instance content", () => {
    const layout = migrateLayoutToOrderedGrid(getDefaultLayouts().find((item) => item.id === "today")!);
    layout.items[0].config = { quick: "today" };
    const reversed = normalizeOrderedItems([...layout.items].reverse());
    expect(reversed.map((item) => item.y)).toEqual([0, 1, 2, 3]);
    expect(reversed.at(-1)?.config).toEqual({ quick: "today" });
    expect(reversed.at(-1)?.config).not.toBe(layout.items[0].config);
  });

  it("uses the upstream four-to-one responsive column ladder", () => {
    expect(computeOrderedGridColumns(1400, 12)).toBe(4);
    expect(computeOrderedGridColumns(900, 12)).toBe(3);
    expect(computeOrderedGridColumns(600, 12)).toBe(2);
    expect(computeOrderedGridColumns(240, 12)).toBe(1);
  });
});

describe("default layouts", () => {
  const registry = createBuiltinWidgetRegistry();

  it("provides one primary workbench plus legacy-compatible layouts and one sidebar layout", () => {
    const defaults = getDefaultLayouts();
    expect(defaults.filter((layout) => layout.surface === "workbench").map((layout) => layout.id)).toEqual([
      "workbench",
      "today",
      "projects",
      "knowledge"
    ]);
    expect(defaults.filter((layout) => layout.surface === "sidebar").map((layout) => layout.id)).toEqual([
      "sidebar-default"
    ]);
    for (const layout of defaults) expect(validateLayout(layout, registry).valid).toBe(true);
  });

  it("returns defensive copies", () => {
    const first = getDefaultLayouts();
    first[0].name = "Changed";
    first[0].items[0].x = 99;
    const second = getDefaultLayouts();
    expect(second[0].name).toBe("工作台");
    expect(second[0].items[0].x).toBe(0);
  });

  it("creates the single workbench from the last active customized layout without removing legacy backups", () => {
    const legacy = getDefaultLayouts().filter((layout) => layout.id !== "workbench");
    const projects = legacy.find((layout) => layout.id === "projects")!;
    projects.items[0].width = 7;
    const migrated = ensureSingleWorkbenchLayout(legacy, "projects");
    const workbench = migrated.find((layout) => layout.id === "workbench")!;
    expect(workbench.name).toBe("工作台");
    expect(workbench.items).toEqual(projects.items);
    expect(workbench.items).not.toBe(projects.items);
    expect(migrated.some((layout) => layout.id === "projects")).toBe(true);
    expect(ensureSingleWorkbenchLayout(migrated, "today")).toEqual(migrated);
  });

  it("adds upcoming tasks to old sidebar layouts without losing existing items", () => {
    const oldLayouts = getDefaultLayouts();
    const sidebar = oldLayouts.find((layout) => layout.id === "sidebar-default")!;
    sidebar.items = [
      { widgetId: "core.context", x: 0, y: 0, width: 1, height: 3 },
      { widgetId: "tasks.context", x: 0, y: 3, width: 1, height: 4 },
      { widgetId: "projects.context", x: 0, y: 7, width: 1, height: 3 },
      { widgetId: "meetings.context", x: 0, y: 10, width: 1, height: 3 },
      { widgetId: "core.quick-create", x: 0, y: 13, width: 1, height: 2 }
    ];

    const upgraded = upgradePersistedLayouts(oldLayouts);
    const upgradedSidebar = upgraded.find((layout) => layout.id === "sidebar-default")!;
    expect(upgradedSidebar.items.filter((item) => item.widgetId === "tasks.upcoming")).toHaveLength(1);
    expect(upgradedSidebar.items.find((item) => item.widgetId === "capture.memo")?.y).toBe(7);
    expect(upgradedSidebar.items.find((item) => item.widgetId === "tasks.context")?.y).toBe(10);
    expect(upgradePersistedLayouts(upgraded).find((layout) => layout.id === "sidebar-default")?.items).toEqual(upgradedSidebar.items);
  });

  it("adds quick memo to the previous default sidebar without changing custom sidebars", () => {
    const sidebar = getDefaultLayouts().find((layout) => layout.id === "sidebar-default")!;
    sidebar.items = sidebar.items.filter((item) => item.widgetId !== "capture.memo");
    sidebar.items = sidebar.items.map((item) => item.y >= 10 ? { ...item, y: item.y - 3 } : item);
    const upgraded = upgradePersistedLayouts([sidebar])[0];
    expect(upgraded.items.find((item) => item.widgetId === "capture.memo")).toMatchObject({ y: 7, height: 3 });
    expect(upgraded.items.find((item) => item.widgetId === "tasks.context")?.y).toBe(10);
    expect(upgradePersistedLayouts([upgraded])).toEqual([upgraded]);
  });

  it("adds the daily-entry widgets above the previous project-only workbench", () => {
    const workbench = {
      version: 1 as const,
      id: "workbench",
      name: "工作台",
      surface: "workbench" as const,
      items: [
        { widgetId: "view.board", instanceId: "status", presetId: "projects.status-board", x: 0, y: 12, width: 12, height: 4 },
        { widgetId: "view.list", instanceId: "milestones", presetId: "projects.milestones", x: 4, y: 0, width: 4, height: 4 },
        { widgetId: "view.list", instanceId: "tasks", presetId: "tasks.all", x: 8, y: 0, width: 4, height: 4 },
        { widgetId: "view.list", instanceId: "clients", presetId: "clients.list", x: 0, y: 4, width: 4, height: 4 },
        { widgetId: "view.list", instanceId: "suppliers", presetId: "suppliers.list", x: 4, y: 4, width: 4, height: 4 },
        { widgetId: "view.list", instanceId: "meetings", presetId: "meetings.actions", x: 0, y: 8, width: 12, height: 4 }
      ]
    };
    const upgraded = upgradePersistedLayouts([workbench])[0];
    expect(upgraded.items.map((item) => item.presetId ?? item.widgetId)).toEqual(expect.arrayContaining([
      "tasks.today-focus", "capture.memo", "core.quick-create", "projects.recent"
    ]));
    expect(upgraded.items.find((item) => item.instanceId === "milestones")?.y).toBe(8);
    expect(upgradePersistedLayouts([upgraded])).toEqual([upgraded]);
  });

  it("upgrades only the exact legacy default today layout and stays idempotent", () => {
    const legacy = {
      version: 1 as const,
      id: "today",
      name: "今日执行",
      surface: "workbench" as const,
      items: [
        { widgetId: "tasks.today", x: 0, y: 0, width: 6, height: 5 },
        { widgetId: "core.calendar", x: 6, y: 0, width: 3, height: 5 },
        { widgetId: "core.quick-create", x: 9, y: 0, width: 3, height: 2 },
        { widgetId: "projects.recent", x: 9, y: 2, width: 3, height: 3 }
      ]
    };
    const upgraded = upgradePersistedLayouts([legacy])[0];
    expect(upgraded.items.map((item) => item.widgetId)).toContain("capture.memo");
    expect(upgraded.items.map((item) => item.widgetId)).not.toContain("core.calendar");
    expect(upgradePersistedLayouts([upgraded])).toEqual([upgraded]);

    const customized = structuredClone(legacy);
    customized.items[0].width = 7;
    const migratedCustom = upgradePersistedLayouts([customized])[0];
    expect(migratedCustom.items[0]).toMatchObject({ widgetId: "view.list", presetId: "tasks.today-focus", width: 7 });
    expect(migratedCustom.items[1]).toMatchObject({ widgetId: "view.calendar", presetId: "tasks.calendar", x: 6, width: 3 });
    expect(migratedCustom.items.some((item) => item.widgetId === "capture.memo")).toBe(false);
    expect(upgradePersistedLayouts([migratedCustom])).toEqual([migratedCustom]);
  });

  it("does not rewrite custom sidebars or re-add an explicitly removed upcoming widget", () => {
    const custom: ReturnType<typeof getDefaultLayouts>[number] = {
      version: 1,
      id: "custom-sidebar",
      name: "自定义侧栏",
      surface: "sidebar",
      items: [{ widgetId: "core.context", x: 0, y: 2, width: 1, height: 4 }]
    };
    expect(upgradePersistedLayouts([custom])).toEqual([custom]);

    const upgradedDefault = getDefaultLayouts().find((layout) => layout.id === "sidebar-default")!;
    upgradedDefault.items = upgradedDefault.items.filter((item) => item.widgetId !== "tasks.upcoming");
    expect(upgradePersistedLayouts([upgradedDefault])[0].items.some((item) => item.widgetId === "tasks.upcoming")).toBe(false);
  });
});

describe("layout validation and management", () => {
  const registry = createBuiltinWidgetRegistry();

  it("rejects invalid JSON, duplicate instance IDs, unknown widgets and wrong surfaces", () => {
    expect(importLayout("{", registry).valid).toBe(false);
    const invalid = {
      version: 1,
      id: "bad",
      name: "Bad",
      surface: "sidebar",
      items: [
        { widgetId: "projects.status", x: 0, y: 0, width: 1, height: 1 },
        { widgetId: "projects.status", x: 0, y: 1, width: 1, height: 1 },
        { widgetId: "missing.widget", x: -1, y: 2, width: 0, height: 1 }
      ]
    };
    const result = validateLayout(invalid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        "Widget does not support sidebar",
        "Widget instance IDs must be unique within a layout",
        "Unknown widget: missing.widget"
      ]));
    }
  });

  it("allows multiple independently configured instances of the same widget", () => {
    const result = validateLayout({
      version: 1,
      id: "instances",
      name: "Instances",
      surface: "workbench",
      items: [
        { widgetId: "view.list", instanceId: "list-client", x: 0, y: 0, width: 6, height: 4, config: { source: { kind: "tasks", scopeMode: "all", clientPath: "clients/a.md" }, query: { limit: 30 } } },
        { widgetId: "view.list", instanceId: "list-internal", x: 6, y: 0, width: 6, height: 4, config: { source: { kind: "tasks", scopeMode: "all", projectType: "内部研发" }, query: { limit: 30 } } }
      ]
    }, registry);
    expect(result.valid).toBe(true);
  });

  it("registers reusable view and control component types", () => {
    for (const id of [
      "view.list", "view.board", "view.calendar", "view.quadrant", "view.timeline",
      "view.metrics", "view.detail", "view.relations", "control.selector", "control.actions", "capture.memo"
    ]) expect(registry.has(id)).toBe(true);
  });

  it("rejects invalid visibility flags and grid overflow", () => {
    const result = validateLayout({
      version: 1,
      id: "overflow",
      name: "Overflow",
      surface: "workbench",
      items: [{ widgetId: "tasks.today", x: 10, y: 0, width: 4, height: 2, hidden: "yes" }]
    }, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        "hidden must be a boolean",
        "Workbench items must fit within the 12-column grid"
      ]));
    }
  });

  it("applies widget-specific config validation", () => {
    const custom = new WidgetRegistry([{ 
      id: "custom.limit",
      title: "Limit",
      surfaces: ["workbench"],
      pack: "core",
      refresh: "manual",
      defaultSize: { width: 1, height: 1 },
      validateConfig: (config) => typeof config.limit === "number" && config.limit > 0
        ? []
        : [{ path: "limit", message: "Must be positive" }]
    }]);
    const result = validateLayout({
      version: 1,
      id: "custom",
      name: "Custom",
      surface: "workbench",
      items: [{ widgetId: "custom.limit", x: 0, y: 0, width: 1, height: 1, config: { limit: 0 } }]
    }, custom);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues[0].path).toBe("items[0].config.limit");
  });

  it("validates persisted today-focus filter config", () => {
    const result = validateLayout({
      version: 1,
      id: "focus-config",
      name: "Focus",
      surface: "workbench",
      items: [{
        widgetId: "tasks.today",
        x: 0,
        y: 0,
        width: 8,
        height: 6,
        config: { quick: "tomorrow", scopes: ["project", "unknown"] }
      }]
    }, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "items[0].config.quick",
      "items[0].config.scopes"
    ]));
  });

  it("copies, renames, imports and restores layouts", () => {
    const manager = new LayoutManager(registry);
    const copy = manager.copy("today", "my-today", "我的今日");
    expect(copy.id).toBe("my-today");
    expect(manager.rename("my-today", "专注模式").name).toBe("专注模式");

    const imported = manager.import(JSON.stringify({
      version: 1,
      id: "imported",
      name: "Imported",
      surface: "sidebar",
      items: [{ widgetId: "core.context", x: 0, y: 0, width: 1, height: 2 }]
    }));
    expect(imported.id).toBe("imported");

    manager.rename("today", "Modified");
    expect(manager.restoreDefault("today").name).toBe("今日执行");
  });

  it("degrades desktop coordinates to ordered one-column mobile cards", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    layout.items[0].collapsed = true;
    layout.items[1].hidden = true;
    const mobile = adaptLayoutForDevice(layout, "mobile");
    expect(mobile.items.every((item) => item.x === 0 && item.width === 1)).toBe(true);
    expect(mobile.items.map((item) => item.y)).toEqual([0, 1, 4, 6]);
    expect(mobile.items[0].collapsed).toBe(true);
    expect(mobile.items[1].hidden).toBe(true);
    expect(adaptLayoutForDevice(layout, "desktop")).toEqual(layout);
  });

  it("supports drag/resize, hide/collapse and explicit mobile ordering", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    const focusKey = layout.items[0].instanceId!;
    const edited = updateLayoutItem(layout, focusKey, {
      x: 2,
      y: 7,
      width: 8,
      height: 6,
      hidden: true,
      collapsed: true
    });
    expect(edited.items.find((item) => item.instanceId === focusKey)).toMatchObject({
      x: 2,
      y: 7,
      width: 8,
      height: 6,
      hidden: true,
      collapsed: true
    });
    expect(layout.items[0].x).toBe(0);

    const order = layout.items.map((item) => item.instanceId ?? item.widgetId).reverse();
    const mobile = reorderMobileLayout(layout, order);
    expect(mobile.items.map((item) => item.instanceId ?? item.widgetId)).toEqual(order);
    expect(mobile.items.every((item) => item.x === 0 && item.width === 1)).toBe(true);
    expect(() => reorderMobileLayout(layout, order.slice(1))).toThrow(/every layout widget/);

    const manager = new LayoutManager(registry);
    const managerFocusKey = manager.get("today")!.items[0].instanceId!;
    expect(manager.updateItem("today", managerFocusKey, { hidden: true }).items[0].hidden).toBe(true);
  });

  it("keeps mobile ordering isolated from desktop coordinates and widget config", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    const focusKey = layout.items[0].instanceId!;
    layout.items[0].config = { quick: "today", scopes: ["project"] };
    layout.items[0].collapsed = true;
    layout.items[0].hidden = true;
    const mobile = reorderMobileLayout(layout, [
      ...layout.items.map((item) => item.instanceId ?? item.widgetId).slice(1),
      focusKey
    ]);

    expect(mobile.items.at(-1)).toMatchObject({
      instanceId: focusKey,
      x: 0,
      width: 1,
      collapsed: true,
      hidden: true,
      config: { quick: "today", scopes: ["project"] }
    });
    expect(layout.items[0]).toMatchObject({ x: 0, width: 8, y: 0 });
    expect(layout.items[0].config).toEqual({ quick: "today", scopes: ["project"] });
    expect(mobile.items.at(-1)?.config).not.toBe(layout.items[0].config);
  });

  it("rejects a damaged persisted layout without mutating the manager", () => {
    const manager = new LayoutManager(registry);
    const before = manager.get("today")!;
    const damaged = structuredClone(before);
    damaged.items[0].x = 12;
    damaged.items[0].width = 2;
    damaged.items[1].widgetId = "missing.widget";

    expect(() => manager.import(damaged)).toThrow(/items\[0\]|items\[1\]/);
    expect(manager.get("today")).toEqual(before);
    expect(validateLayout(damaged, registry).valid).toBe(false);
  });

  it("orders mobile cards deterministically when desktop items share a position", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    layout.items = layout.items.map((item) => ({ ...item, x: 0, y: 0 }));
    const ids = layout.items.map((item) => item.instanceId ?? item.widgetId);
    const first = adaptLayoutForDevice(layout, "mobile");
    const second = adaptLayoutForDevice(layout, "mobile");

    expect(first.items.map((item) => item.instanceId ?? item.widgetId)).toEqual(ids);
    expect(second).toEqual(first);
    const expectedY: number[] = [];
    let nextY = 0;
    for (const item of layout.items) {
      expectedY.push(nextY);
      nextY += item.collapsed ? 1 : Math.max(1, item.height);
    }
    expect(first.items.map((item) => item.y)).toEqual(expectedY);
  });
});
