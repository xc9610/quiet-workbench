import { describe, expect, it, vi } from "vitest";
import {
  WorkflowContext,
  WorkflowEngine,
  WorkflowValidationError,
  type WorkflowDefinition
} from "../src/workflows";

const createProject: WorkflowDefinition = {
  id: "project.create",
  title: "创建项目",
  steps: [
    { type: "form", id: "details", fields: [{ id: "name", label: "名称", required: true }] },
    { type: "select", id: "status", bind: "status", options: [{ value: "open", label: "进行中" }] },
    { type: "preview", id: "preview", render: (context) => `${context.get("name")} / ${context.get("status")}` },
    { type: "confirm", id: "confirm", message: (context) => `创建 ${context.get("name")}?` },
    { type: "write", id: "write", bind: "receipt", execute: (context) => ({ path: `${context.get("name")}.md` }) },
    { type: "done", id: "done", result: (context) => context.get("receipt") }
  ]
};

describe("WorkflowContext", () => {
  it("inherits parent values while keeping child writes scoped", () => {
    const parent = new WorkflowContext({ client: "Acme" });
    const child = parent.child({ project: "Launch" });
    expect(child.get("client")).toBe("Acme");
    child.set("client", "Child override");
    expect(parent.get("client")).toBe("Acme");
    expect(child.snapshot()).toEqual({ client: "Child override", project: "Launch" });
  });
});

describe("WorkflowEngine", () => {
  it("runs form, select, preview, confirm, write and done steps", async () => {
    const engine = new WorkflowEngine();
    expect(engine.start(createProject).stepId).toBe("details");
    await engine.submit({ name: "Launch" });
    await engine.submit("open");
    expect(engine.preview()).toBe("Launch / open");
    await engine.submit();
    expect(engine.confirmationMessage()).toBe("创建 Launch?");
    await engine.submit(true);
    await engine.submit();
    const result = await engine.submit();
    expect(result).toEqual({ status: "completed", result: { path: "Launch.md" }, parent: undefined });
    expect(engine.depth).toBe(0);
  });

  it("does not execute a write before confirmation", async () => {
    const write = vi.fn();
    const engine = new WorkflowEngine();
    engine.start({
      id: "safe.write",
      title: "Safe write",
      steps: [
        { type: "confirm", id: "confirm", message: "Continue?" },
        { type: "write", id: "write", execute: write },
        { type: "done", id: "done" }
      ]
    });
    const result = await engine.submit(false);
    expect(result.status).toBe("cancelled");
    expect(write).not.toHaveBeenCalled();
  });

  it("validates form and select values", async () => {
    const engine = new WorkflowEngine();
    engine.start(createProject);
    await expect(engine.submit({ name: "" })).rejects.toBeInstanceOf(WorkflowValidationError);
    await engine.submit({ name: "Launch" });
    await expect(engine.submit("closed")).rejects.toBeInstanceOf(WorkflowValidationError);
    expect(engine.snapshot().stepId).toBe("status");
  });

  it("returns a nested workflow result without losing the parent context", async () => {
    const engine = new WorkflowEngine();
    engine.start(createProject, { source: "workbench" });
    const nested: WorkflowDefinition = {
      id: "client.create",
      title: "创建客户",
      steps: [
        { type: "form", id: "form", bind: "client", fields: [{ id: "name", label: "名称", required: true }] },
        { type: "done", id: "done", result: (context) => context.get("client") }
      ]
    };
    engine.beginNested(nested, {}, "createdClient");
    expect(engine.depth).toBe(2);
    expect(engine.context.get("source")).toBe("workbench");
    await engine.submit({ name: "Acme" });
    const result = await engine.submit();
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected nested workflow completion");
    expect(result.parent?.workflowId).toBe("project.create");
    expect(engine.context.get("createdClient")).toEqual({ name: "Acme" });
    expect(engine.context.get("source")).toBe("workbench");
  });
});
