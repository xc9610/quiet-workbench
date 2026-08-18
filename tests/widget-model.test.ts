import { describe, expect, it } from "vitest";
import { migrateLegacyWidgetItem, presetsForType } from "../src/core/widget-model";

describe("generic widget model", () => {
  it("reuses one list type for multiple task and project presets", () => {
    const ids = presetsForType("view.list").map((preset) => preset.id);
    expect(ids).toEqual(expect.arrayContaining([
      "tasks.today-focus",
      "tasks.waiting",
      "tasks.week",
      "projects.list",
      "projects.risks"
    ]));
  });

  it("migrates a legacy functional widget without changing its geometry", () => {
    const migrated = migrateLegacyWidgetItem({
      widgetId: "tasks.waiting",
      x: 3,
      y: 4,
      width: 5,
      height: 6,
      config: { projectType: "客户项目", limit: 12 }
    }, 2);
    expect(migrated).toMatchObject({
      widgetId: "view.list",
      presetId: "tasks.waiting",
      title: "等待与跟进",
      x: 3,
      y: 4,
      width: 5,
      height: 6
    });
    expect((migrated.config?.source as Record<string, unknown>).projectType).toBe("客户项目");
    expect((migrated.config?.query as Record<string, unknown>).limit).toBe(12);
  });

  it("keeps generic instances unchanged on repeated migration", () => {
    const item = {
      widgetId: "view.list",
      instanceId: "my-waiting",
      title: "我的等待",
      presetId: "tasks.waiting",
      x: 0,
      y: 0,
      width: 6,
      height: 4,
      config: { source: { kind: "tasks", scopeMode: "all" }, query: { mode: "waiting" } }
    };
    expect(migrateLegacyWidgetItem(item, 0)).toEqual(item);
  });
});
