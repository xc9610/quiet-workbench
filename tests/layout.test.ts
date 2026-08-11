import { describe, expect, it } from "vitest";
import {
  adaptLayoutForDevice,
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

describe("default layouts", () => {
  const registry = createBuiltinWidgetRegistry();

  it("provides three workbench scenes and one sidebar layout", () => {
    const defaults = getDefaultLayouts();
    expect(defaults.filter((layout) => layout.surface === "workbench").map((layout) => layout.id)).toEqual([
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
    expect(second[0].name).toBe("今日执行");
    expect(second[0].items[0].x).toBe(0);
  });

  it("adds upcoming tasks to old sidebar layouts without losing existing items", () => {
    const oldLayouts = getDefaultLayouts();
    const sidebar = oldLayouts.find((layout) => layout.id === "sidebar-default")!;
    sidebar.items = sidebar.items.filter((item) => item.widgetId !== "tasks.upcoming");
    sidebar.items = sidebar.items.map((item) => item.y > 3 ? { ...item, y: item.y - 4 } : item);

    const upgraded = upgradePersistedLayouts(oldLayouts);
    const upgradedSidebar = upgraded.find((layout) => layout.id === "sidebar-default")!;
    expect(upgradedSidebar.items.filter((item) => item.widgetId === "tasks.upcoming")).toHaveLength(1);
    expect(upgradedSidebar.items.find((item) => item.widgetId === "tasks.context")?.y).toBe(7);
    expect(upgradePersistedLayouts(upgraded).find((layout) => layout.id === "sidebar-default")?.items).toEqual(upgradedSidebar.items);
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

  it("rejects invalid JSON, unknown widgets, duplicates and wrong surfaces", () => {
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
        "A widget may appear only once per layout",
        "Unknown widget: missing.widget"
      ]));
    }
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
    expect(mobile.items.map((item) => item.y)).toEqual([0, 1, 6, 8]);
    expect(mobile.items[0].collapsed).toBe(true);
    expect(mobile.items[1].hidden).toBe(true);
    expect(adaptLayoutForDevice(layout, "desktop")).toEqual(layout);
  });

  it("supports drag/resize, hide/collapse and explicit mobile ordering", () => {
    const layout = getDefaultLayouts().find((item) => item.id === "today")!;
    const edited = updateLayoutItem(layout, "tasks.today", {
      x: 2,
      y: 7,
      width: 8,
      height: 6,
      hidden: true,
      collapsed: true
    });
    expect(edited.items.find((item) => item.widgetId === "tasks.today")).toMatchObject({
      x: 2,
      y: 7,
      width: 8,
      height: 6,
      hidden: true,
      collapsed: true
    });
    expect(layout.items[0].x).toBe(0);

    const order = layout.items.map((item) => item.widgetId).reverse();
    const mobile = reorderMobileLayout(layout, order);
    expect(mobile.items.map((item) => item.widgetId)).toEqual(order);
    expect(mobile.items.every((item) => item.x === 0 && item.width === 1)).toBe(true);
    expect(() => reorderMobileLayout(layout, order.slice(1))).toThrow(/every layout widget/);

    const manager = new LayoutManager(registry);
    expect(manager.updateItem("today", "tasks.today", { hidden: true }).items[0].hidden).toBe(true);
  });
});
