import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import {
  activeFocusFilterCount,
  DEFAULT_FOCUS_FILTERS,
  filterFocusTasks,
  normalizeEntityLink,
  resolveEntityReference,
  type FocusFilters,
  type FocusTaskRecord
} from "../src/domain/focus";
import { appendQuickMemoContent, quickMemoTimestamp, recentQuickMemoEntries } from "../src/domain/memo";

function task(overrides: Partial<FocusTaskRecord> & Pick<TaskRecord, "id" | "text">): FocusTaskRecord {
  return {
    scope: "project",
    path: `projects/${overrides.id}.md`,
    line: 1,
    completed: false,
    priority: "normal",
    sourceName: overrides.id,
    revision: "r1",
    clientIds: [],
    ...overrides
  };
}

function filters(patch: Partial<FocusFilters>): FocusFilters {
  return { ...structuredClone(DEFAULT_FOCUS_FILTERS), ...patch };
}

describe("today focus filtering", () => {
  const rows = [
    task({ id: "due", text: "今天截止", due: "2026-08-11", projectType: "内部研发", clientIds: ["clients/a.md"] }),
    task({ id: "scheduled", text: "今天计划", scheduled: "2026-08-11", scope: "client", clientIds: ["clients/b.md"] }),
    task({ id: "overdue", text: "已经逾期", due: "2026-08-10", priority: "high", clientIds: ["clients/a.md"] }),
    task({ id: "high", text: "无日期高优先", priority: "highest", projectType: "合同交付", clientIds: ["clients/c.md"] }),
    task({ id: "done", text: "已完成", due: "2026-08-11", completed: true, clientIds: ["clients/a.md"] })
  ];

  it("distinguishes today, overdue, high-priority and all quick filters", () => {
    expect(filterFocusTasks(rows, filters({ quick: "today" }), "2026-08-11").map((row) => row.id)).toEqual(["due", "scheduled"]);
    expect(filterFocusTasks(rows, filters({ quick: "overdue" }), "2026-08-11").map((row) => row.id)).toEqual(["overdue"]);
    expect(filterFocusTasks(rows, filters({ quick: "high" }), "2026-08-11").map((row) => row.id)).toEqual(["overdue", "high"]);
    expect(filterFocusTasks(rows, filters({ quick: "all" }), "2026-08-11")).toHaveLength(4);
  });

  it("uses OR within a group and AND across groups", () => {
    const result = filterFocusTasks(rows, filters({
      quick: "all",
      scopes: ["project", "client"],
      projectTypes: ["内部研发", "合同交付"],
      clients: ["clients/a.md", "clients/c.md"],
      priorities: ["normal", "highest"]
    }), "2026-08-11");
    expect(result.map((row) => row.id)).toEqual(["due", "high"]);
  });

  it("can explicitly show completed tasks and counts non-default filters", () => {
    const state = filters({ quick: "all", statuses: ["completed"], clients: ["clients/a.md"] });
    expect(filterFocusTasks(rows, state, "2026-08-11").map((row) => row.id)).toEqual(["done"]);
    expect(activeFocusFilterCount(state)).toBe(2);
  });

  it("normalizes wikilink targets instead of display aliases", () => {
    expect(normalizeEntityLink("[[10_业务/客户/紫薇科技.md|紫薇]]")).toBe("紫薇科技");
    expect(normalizeEntityLink("[[紫薇科技]]")).toBe("紫薇科技");
    const clients = [
      { path: "clients/a/紫薇科技.md", name: "紫薇科技", aliases: ["紫薇"] },
      { path: "clients/b/紫薇科技.md", name: "另一家紫薇科技", aliases: ["紫薇二号"] }
    ];
    expect(resolveEntityReference("[[clients/b/紫薇科技.md|紫薇二号]]", clients)?.path).toBe("clients/b/紫薇科技.md");
    expect(resolveEntityReference("紫薇", clients)?.path).toBe("clients/a/紫薇科技.md");
  });
});

describe("quick memo content", () => {
  const morning = { date: "2026-08-18", time: "08:42" };

  it("creates dated entries and preserves existing bytes while appending", () => {
    expect(appendQuickMemoContent("", "第一条", morning)).toBe("# Workbench速记\n\n## 2026-08-18\n\n- 08:42 第一条\n");
    const before = "原文  \n\n";
    expect(appendQuickMemoContent(before, "第二条", morning)).toBe(`${before}## 2026-08-18\n\n- 08:42 第二条\n`);
    const sameDay = "# Workbench速记\n\n## 2026-08-18\n\n- 08:42 第一条\n";
    expect(appendQuickMemoContent(sameDay, "第二条\n补充说明", { date: "2026-08-18", time: "09:15" }))
      .toBe(`${sameDay}- 09:15 第二条\n  补充说明\n`);
  });

  it("rejects empty content and returns structured recent entries", () => {
    expect(() => appendQuickMemoContent("existing", "  \n ", morning)).toThrow(/不能为空/);
    const content = "# Workbench速记\n\n## 2026-08-18\n\n- 08:42 一\n- 09:15 二\n  补充\n\n## 2026-08-19\n\n- 07:30 三\n";
    expect(recentQuickMemoEntries(content, 2)).toEqual([
      { date: "2026-08-19", time: "07:30", text: "三" },
      { date: "2026-08-18", time: "09:15", text: "二\n补充" }
    ]);
  });

  it("does not treat the standalone memo file header as a legacy entry", () => {
    const content = `---
type: 工作记录
aliases:
  - Quiet Workbench 速记
---

# Quiet Workbench 速记

由 Quiet Workbench 追加分条速记；每条记录自动带本地时间戳。
`;
    expect(recentQuickMemoEntries(content)).toEqual([]);
  });

  it("formats local timestamps deterministically", () => {
    const value = new Date(2026, 7, 18, 8, 5);
    expect(quickMemoTimestamp(value)).toEqual({ date: "2026-08-18", time: "08:05" });
  });
});
