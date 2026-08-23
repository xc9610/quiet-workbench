import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import { contentRevision, parseMarkdown } from "../src/domain/markdown";
import { MeetingMigrationService, type MeetingMigrationInput } from "../src/services/meeting-migration-service";
import { WriteTransactionExecutor } from "../src/services/transaction-service";
import type { VaultFileInfo, VaultPort } from "../src/services/vault-port";

class BatchMemoryVault implements VaultPort {
  readonly files = new Map<string, { content: string; mtime: number }>();
  readonly failWrite = new Set<string>();
  afterWrite?: (path: string, vault: BatchMemoryVault) => void;
  private clock = 1;

  seed(path: string, content: string): void {
    this.files.set(path, { content, mtime: this.clock++ });
  }

  async listMarkdownFiles(folder: string): Promise<VaultFileInfo[]> {
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(`${folder}/`) && path.endsWith(".md"))
      .map(([path, file]) => ({ path, mtime: file.mtime, size: file.content.length }));
  }

  async read(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing: ${path}`);
    return file.content;
  }

  async write(path: string, content: string, expectedRevision?: string): Promise<void> {
    if (this.failWrite.has(path)) throw new Error(`Injected write failure: ${path}`);
    const current = this.files.get(path);
    if (!current) throw new Error(`Missing: ${path}`);
    if (expectedRevision && contentRevision(current.content) !== expectedRevision) throw new Error(`Conflict: ${path}`);
    this.files.set(path, { content, mtime: this.clock++ });
    this.afterWrite?.(path, this);
  }

  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`Exists: ${path}`);
    this.files.set(path, { content, mtime: this.clock++ });
  }

  async trash(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`Missing: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<VaultFileInfo | undefined> {
    const file = this.files.get(path);
    return file ? { path, mtime: file.mtime, size: file.content.length } : undefined;
  }
}

function tasks(content: string, path: string): TaskRecord[] {
  return parseMarkdown(content, {
    path,
    sourceName: path,
    scope: "meeting-draft",
    taskHeadings: ["后续动作"]
  }).tasks;
}

function inputs(sourceTasks: TaskRecord[], targetPath = "projects/p.md"): MeetingMigrationInput[] {
  return sourceTasks.map((sourceTask) => ({ sourceTask, targetPath, targetScope: "project" }));
}

describe("MeetingMigrationService batches", () => {
  it("migrates several actions with an item-level receipt and no duplicate target tasks", async () => {
    const vault = new BatchMemoryVault();
    const sourcePath = "meetings/m.md";
    vault.seed(sourcePath, "---\ntype: 会议纪要\n---\n## 后续动作\n- [ ] 行动甲 ^meeting-a\n- [ ] 行动乙 ^meeting-b");
    vault.seed("projects/p.md", "---\ntype: 项目\n---\n## 待办\n");
    const service = new MeetingMigrationService(vault, new WriteTransactionExecutor(vault));

    const batch = await service.migrateBatch({ items: inputs(tasks(await vault.read(sourcePath), sourcePath)), batchId: "batch-1" });

    expect(batch).toMatchObject({
      id: "batch-1",
      status: "completed",
      migratedCount: 2,
      alreadyMigratedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      retryItems: []
    });
    expect(batch.items.every((item) => item.receipt?.status === "committed")).toBe(true);
    const target = await vault.read("projects/p.md");
    expect(target.match(/quiet-workbench:source/g)).toHaveLength(2);
    expect((await vault.read(sourcePath)).match(/quiet-workbench:migrated/g)).toHaveLength(2);

    const rerun = await service.migrateBatch({ items: inputs(tasks(await vault.read(sourcePath), sourcePath)) });
    expect(rerun.alreadyMigratedCount).toBe(2);
    expect((await vault.read("projects/p.md")).match(/quiet-workbench:source/g)).toHaveLength(2);
  });

  it("stops after failure and resumes failed and skipped items after the cause is removed", async () => {
    const vault = new BatchMemoryVault();
    const sourcePath = "meetings/m.md";
    vault.seed(sourcePath, "## 后续动作\n- [ ] 行动甲 ^meeting-a\n- [ ] 行动乙 ^meeting-b");
    vault.seed("projects/p.md", "## 待办\n");
    const service = new MeetingMigrationService(vault, new WriteTransactionExecutor(vault));
    const originalInputs = inputs(tasks(await vault.read(sourcePath), sourcePath));
    vault.failWrite.add("projects/p.md");

    const failed = await service.migrateBatch({ items: originalInputs, stopOnFailure: true, batchId: "batch-stop" });
    expect(failed).toMatchObject({ status: "failed", failedCount: 1, skippedCount: 1 });
    expect(failed.items.map((item) => item.outcome)).toEqual(["failed", "skipped"]);
    expect(failed.retryItems).toHaveLength(2);

    vault.failWrite.clear();
    const resumed = await service.retryBatch(failed);
    expect(resumed).toMatchObject({ status: "completed", migratedCount: 2, failedCount: 0, skippedCount: 0 });
    expect((await vault.read("projects/p.md")).match(/quiet-workbench:source/g)).toHaveLength(2);
  });

  it("reports unresolved compensation and safely finishes it without duplicating the target", async () => {
    const vault = new BatchMemoryVault();
    const sourcePath = "meetings/m.md";
    vault.seed(sourcePath, "## 后续动作\n- [ ] 补发确认函 ^meeting-a");
    vault.seed("projects/p.md", "## 待办\n");
    const service = new MeetingMigrationService(vault, new WriteTransactionExecutor(vault));
    const originalInputs = inputs(tasks(await vault.read(sourcePath), sourcePath));
    vault.failWrite.add(sourcePath);
    vault.afterWrite = (path, target) => {
      if (path === "projects/p.md") target.seed(path, `${target.files.get(path)?.content ?? ""}\n外部并发编辑`);
    };

    const partial = await service.migrateBatch({ items: originalInputs, batchId: "batch-partial" });
    expect(partial).toMatchObject({ status: "failed", failedCount: 1 });
    expect(partial.items[0]?.receipt?.status).toBe("partial");
    expect(partial.manualRepairPaths).toEqual(["projects/p.md"]);
    expect((await vault.read("projects/p.md")).match(/quiet-workbench:source/g)).toHaveLength(1);

    vault.failWrite.clear();
    vault.afterWrite = undefined;
    const recovered = await service.retryBatch(partial);
    expect(recovered).toMatchObject({ status: "completed", migratedCount: 1 });
    expect((await vault.read("projects/p.md")).match(/quiet-workbench:source/g)).toHaveLength(1);
    expect(await vault.read(sourcePath)).toContain("quiet-workbench:migrated");
  });

  it("refreshes a block-ID task for retry but refuses to redirect a changed block-less line", async () => {
    const vault = new BatchMemoryVault();
    vault.seed("meetings/stable.md", "## 后续动作\n- [ ] 原行动 ^stable-action");
    vault.seed("meetings/unstable.md", "## 后续动作\n- [ ] 无块标识");
    vault.seed("projects/p.md", "## 待办\n");
    const service = new MeetingMigrationService(vault, new WriteTransactionExecutor(vault));
    const stable = inputs(tasks(await vault.read("meetings/stable.md"), "meetings/stable.md"))[0];
    const unstable = inputs(tasks(await vault.read("meetings/unstable.md"), "meetings/unstable.md"))[0];
    vault.seed("meetings/stable.md", "## 后续动作\n- [ ] 已澄清行动 ^stable-action");
    vault.seed("meetings/unstable.md", "## 后续动作\n- [ ] 另一项行动");

    const conflicted = await service.migrateBatch({ items: [stable, unstable] });
    expect(conflicted.items.map((item) => item.outcome)).toEqual(["conflict", "conflict"]);

    const retried = await service.retryBatch(conflicted);
    expect(retried.status).toBe("partial");
    expect(retried.items.map((item) => item.outcome).sort()).toEqual(["error", "migrated"]);
    expect(retried.items.find((item) => item.outcome === "error")?.message).toContain("manual confirmation");
    expect(await vault.read("projects/p.md")).toContain("已澄清行动");
    expect(await vault.read("projects/p.md")).not.toContain("另一项行动");
  });

  it("keeps protected template targets unchanged and returns a retryable failure", async () => {
    const vault = new BatchMemoryVault();
    vault.seed("meetings/m.md", "## 后续动作\n- [ ] 不应写入模板 ^meeting-a");
    vault.seed("templates/project.md", "template-v1");
    const executor = new WriteTransactionExecutor(vault, undefined, {
      isPathProtected: (path) => path === "templates/project.md"
    });
    const service = new MeetingMigrationService(vault, executor);

    const result = await service.migrateBatch({
      items: inputs(tasks(await vault.read("meetings/m.md"), "meetings/m.md"), "templates/project.md")
    });

    expect(result).toMatchObject({ status: "failed", failedCount: 1 });
    expect(result.items[0]?.message).toContain("Protected file is read-only");
    expect(await vault.read("templates/project.md")).toBe("template-v1");
    expect(await vault.read("meetings/m.md")).not.toContain("quiet-workbench:migrated");
  });
});
