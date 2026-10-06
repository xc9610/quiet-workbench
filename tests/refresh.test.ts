import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshCoordinator, type RefreshBatch } from "../src/core/refresh-coordinator";
import { ViewRefreshState } from "../src/core/view-refresh-state";
import { sourceFilterFields } from "../src/core/widget-capabilities";
import { createBuiltinWidgetRegistry } from "../src/core/widget-registry";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("refresh coordination", () => {
  it("merges bursts, including rename old paths, without parallel execution", async () => {
    const batches: RefreshBatch[] = [];
    const execute = vi.fn(async (batch: RefreshBatch) => { batches.push(batch); });
    const coordinator = new RefreshCoordinator(execute);
    coordinator.schedule({ paths: ["projects/old.md", "projects/new.md"] }, () => {});
    coordinator.schedule({ paths: ["projects/new.md"], memo: true }, () => {});
    await vi.advanceTimersByTimeAsync(350);
    expect(batches).toHaveLength(1);
    expect([...batches[0].paths]).toEqual(["projects/old.md", "projects/new.md"]);
    expect(batches[0].memo).toBe(true);
  });
  it("waits for events during a scan and publishes only the final result", async () => {
    const gate = deferred();
    const batches: RefreshBatch[] = [];
    const publish = vi.fn();
    const coordinator = new RefreshCoordinator(async (batch) => { batches.push(batch); if (batches.length === 1) await gate.promise; }, publish);
    const first = coordinator.request({ full: true });
    await Promise.resolve();
    let acknowledged = false;
    const second = coordinator.request({ paths: ["projects/changed.md"] }).then(() => { acknowledged = true; });
    expect(batches).toHaveLength(1);
    expect(acknowledged).toBe(false);
    gate.resolve();
    await Promise.all([first, second]);
    expect(batches).toHaveLength(2);
    expect(batches[1].paths.has("projects/changed.md")).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(acknowledged).toBe(true);
  });
  it("retains failed ranges and the last event for retry", async () => {
    const gate = deferred();
    const batches: RefreshBatch[] = [];
    const coordinator = new RefreshCoordinator(async (batch) => {
      batches.push(batch);
      if (batches.length === 1) { await gate.promise; throw new Error("fixture failure"); }
    });
    const first = coordinator.request({ memo: true, paths: ["a.md"] });
    await Promise.resolve();
    coordinator.schedule({ paths: ["b.md"], activity: true }, () => {});
    gate.resolve();
    await expect(first).rejects.toThrow("fixture failure");
    await coordinator.request({});
    expect([...batches[1].paths]).toEqual(["b.md", "a.md"]);
    expect(batches[1].memo && batches[1].activity).toBe(true);
  });
  it("drains requests raised by subscribers before acknowledging", async () => {
    let requested = false;
    const execute = vi.fn(async () => {});
    const coordinator = new RefreshCoordinator(execute, () => {
      if (!requested) { requested = true; void coordinator.request({ memo: true }); }
    });
    await coordinator.request({ full: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("cancels scheduled work and rejects late publication after disposal", async () => {
    const gate = deferred();
    const publish = vi.fn();
    const execute = vi.fn(async () => { await gate.promise; });
    const coordinator = new RefreshCoordinator(execute, publish);
    const pending = coordinator.request({ full: true });
    await Promise.resolve();
    coordinator.schedule({ memo: true }, () => {});
    coordinator.dispose(); gate.resolve(); await pending;
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    await coordinator.request({ full: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
describe("page refresh state", () => {
  it("publishes the latest hidden snapshot once on reopening", () => {
    const publish = vi.fn(); const state = new ViewRefreshState(publish);
    state.offer(1, false); state.offer(2, false); state.offer(3, false);
    expect(publish).not.toHaveBeenCalled();
    state.flush(true); state.flush(true);
    expect(publish).toHaveBeenCalledExactlyOnceWith(3);
  });
  it("holds edits and ignores updates after close", () => {
    const publish = vi.fn(); const state = new ViewRefreshState(publish);
    state.offer("first", true, true); state.offer("latest", true, true);
    state.flush(true, false);
    expect(publish).toHaveBeenCalledExactlyOnceWith("latest");
    state.dispose(); state.offer("late", true); state.flush(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
it("declares component dependencies and shows filters for the chosen source", () => {
  const registry = createBuiltinWidgetRegistry();
  expect(registry.require("view.list").dependencies).toContain("tasks");
  expect(registry.require("capture.memo").dependencies).toEqual(["memo"]);
  expect(sourceFilterFields("suppliers").has("taskScopes")).toBe(false);
  expect(sourceFilterFields("clients").has("projectType")).toBe(false);
  expect(sourceFilterFields("tasks").has("taskScopes")).toBe(true);
});
