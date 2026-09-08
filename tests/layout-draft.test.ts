import { describe, expect, it } from "vitest";
import type { LayoutItem } from "../src/core/types";
import {
  cloneLayoutItems,
  moveVisibleLayoutItem,
  patchLayoutItem,
  recordLayoutHistory,
  removeLayoutItem
} from "../src/core/layout-draft";

function item(id: string, hidden = false): LayoutItem {
  return {
    widgetId: "view.list",
    instanceId: id,
    x: 0,
    y: 0,
    width: 3,
    height: 2,
    hidden,
    config: { query: { limit: 10 } }
  };
}

describe("layout draft helpers", () => {
  it("clones nested widget configuration before recording history", () => {
    const source = [item("a")];
    const clone = cloneLayoutItems(source);
    const history = recordLayoutHistory([], source);

    expect(clone).toEqual(source);
    expect(clone[0].config).not.toBe(source[0].config);
    expect(history[0][0].config).not.toBe(source[0].config);
  });

  it("moves only across the currently visible reading order", () => {
    const items = [item("a"), item("hidden", true), item("b"), item("c")];
    const next = moveVisibleLayoutItem(items, ["a", "b", "c"], "b", -1);

    expect(next.map((entry) => entry.instanceId)).toEqual(["b", "hidden", "a", "c"]);
    expect(moveVisibleLayoutItem(next, ["b", "a", "c"], "b", -1)).toBe(next);
  });

  it("patches and removes the requested instance without mutating siblings", () => {
    const items = [item("a"), item("b")];
    const patched = patchLayoutItem(items, "b", { collapsed: true });

    expect(patched[0]).toBe(items[0]);
    expect(patched[1]).toMatchObject({ instanceId: "b", collapsed: true });
    expect(removeLayoutItem(patched, "a").map((entry) => entry.instanceId)).toEqual(["b"]);
  });

  it("keeps the configured number of reversible snapshots", () => {
    let history: LayoutItem[][] = [];
    for (let index = 0; index < 5; index += 1) {
      history = recordLayoutHistory(history, [item(String(index))], 3);
    }
    expect(history.map((snapshot) => snapshot[0].instanceId)).toEqual(["2", "3", "4"]);
  });
});
