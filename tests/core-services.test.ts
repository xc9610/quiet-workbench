import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import { EntityIndex } from "../src/services/entity-index";
import { MeetingMigrationService } from "../src/services/meeting-migration-service";
import { ProjectTaskService } from "../src/services/task-service";
import { formatDate, TemplateService, UnsupportedTemplateExpressionError } from "../src/services/template-service";
import { TransactionJournal, WriteTransactionExecutor } from "../src/services/transaction-service";
import type { VaultFileInfo, VaultPort } from "../src/services/vault-port";
import { canonicalizeFields, type EntityIndexConfig } from "../src/domain/entities";
import { contentRevision, parseMarkdown } from "../src/domain/markdown";
import { RevisionConflictError } from "../src/domain/transactions";

class MemoryVault implements VaultPort {
  readonly files = new Map<string, { content: string; mtime: number }>();
  readonly trashed: string[] = [];
  failWrite = new Set<string>();
  afterWrite?: (path: string, vault: MemoryVault) => void;
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

  async write(path: string, content: string): Promise<void> {
    if (this.failWrite.has(path)) throw new Error(`Injected write failure: ${path}`);
    if (!this.files.has(path)) throw new Error(`Missing: ${path}`);
    this.files.set(path, { content, mtime: this.clock++ });
    this.afterWrite?.(path, this);
  }

  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`Exists: ${path}`);
    this.files.set(path, { content, mtime: this.clock++ });
  }

  async trash(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`Missing: ${path}`);
    this.trashed.push(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<VaultFileInfo | undefined> {
    const file = this.files.get(path);
    return file ? { path, mtime: file.mtime, size: file.content.length } : undefined;
  }
}

describe("Markdown domain", () => {
  it("parses frontmatter aliases and scoped task metadata without reading code fences", () => {
    const source = [
      "---",
      "name: 示例客户",
      "aliases: [示例, 'Example']",
      "company_type: 科研院所",
      "tags:",
      "  - 客户",
      "---",
      "## 待办",
      "- [ ] 准备方案 🔼 ⏳ 2026-08-10 📅 2026-08-12 ^action-1",
      "```md",
      "- [ ] 这不是任务",
      "```"
    ].join("\n");
    const parsed = parseMarkdown(source, { path: "clients/a.md", sourceName: "示例客户", scope: "client" });
    const canonical = canonicalizeFields(parsed.frontmatter?.fields ?? {}, {
      organization_type: ["company_type"]
    });
    expect(canonical.organization_type).toBe("科研院所");
    expect(parsed.frontmatter?.fields.aliases).toEqual(["示例", "Example"]);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]).toMatchObject({
      scope: "client",
      text: "准备方案",
      priority: "high",
      scheduled: "2026-08-10",
      due: "2026-08-12",
      blockId: "action-1"
    });
  });

  it("limits tasks to configured level-two sections and clears on a new top-level heading", () => {
    const source = "## 待办\n### 子步骤\n- [ ] 应索引\n# 附录\n- [ ] 不应索引";
    const parsed = parseMarkdown(source, {
      path: "projects/a.md",
      sourceName: "项目甲",
      scope: "project",
      taskHeadings: ["待办"]
    });
    expect(parsed.tasks.map((task) => task.text)).toEqual(["应索引"]);
  });
});

describe("TemplateService", () => {
  it("formats calendar dates from local time at midnight instead of UTC", () => {
    const localAfterMidnight = new Date(2026, 7, 11, 0, 23, 0);

    expect(formatDate(localAfterMidnight, "YYYY-MM-DD")).toBe("2026-08-11");
  });

  it("renders only title and deterministic date expressions", () => {
    const service = new TemplateService();
    const result = service.render(
      "# <% tp.file.title %>\n<% tp.date.now(\"YYYY-MM-DD HH:mm\") %>",
      { title: "项目甲", now: new Date(2026, 7, 10, 9, 5, 4) }
    );
    expect(result).toBe("# 项目甲\n2026-08-10 09:05");
    expect(() => service.render("<% tp.system.prompt() %>", { title: "x" })).toThrow(
      UnsupportedTemplateExpressionError
    );
  });
});

describe("EntityIndex", () => {
  const config: EntityIndexConfig = {
    definitions: [
      { kind: "project", folder: "projects", typeValues: ["项目"] },
      {
        kind: "client",
        folder: "clients",
        typeValues: ["客户"],
        aliases: { organization_type: ["company_type"] }
      },
      { kind: "supplier", folder: "suppliers", typeValues: ["供应商"] },
      { kind: "meeting", folder: "meetings", typeValues: ["会议", "会议纪要"] },
      { kind: "knowledge", folder: "knowledge", typeValues: ["知识"] }
    ]
  };

  it("indexes all entity kinds and incrementally refreshes changed and deleted files", async () => {
    const vault = new MemoryVault();
    vault.seed("projects/a.md", "---\nname: 项目甲\ntype: 项目\n---\n## 待办\n- [ ] 推进项目");
    vault.seed("clients/a.md", "---\nname: 客户甲\ntype: 客户\ncompany_type: 企业\n---\n- [ ] 回访客户");
    vault.seed("suppliers/a.md", "---\nname: 供应商甲\ntype: 供应商\n---");
    vault.seed("meetings/a.md", "---\ntitle: 周会\ntype: 会议纪要\n---\n## 技术检查\n- [ ] 不应迁移\n## 后续动作\n- [ ] 会议动作");
    vault.seed("knowledge/a.md", "---\ntitle: 知识甲\ntype: 知识\nstatus: 待沉淀\n---");
    const index = new EntityIndex(vault, config);
    const first = await index.scan();
    expect(first.added).toHaveLength(5);
    expect(index.listEntities()).toHaveLength(5);
    expect(index.listTasks("meeting-draft")).toHaveLength(1);
    expect(index.getEntity("clients/a.md")?.fields.organization_type).toBe("企业");
    expect(index.getEntity("knowledge/a.md")?.fields.triage_status).toBe("待沉淀");

    vault.seed("projects/a.md", "---\nname: 项目甲\ntype: 项目\nstatus: 进行中\n---\n- [ ] 新任务");
    const changed = await index.refreshPath("projects/a.md");
    expect(changed.changed).toEqual(["projects/a.md"]);
    vault.files.delete("projects/a.md");
    const removed = await index.refreshPath("projects/a.md");
    expect(removed.removed).toEqual(["projects/a.md"]);
  });

  it("excludes wrong-type, history, and explanatory notes from business entities", async () => {
    const vault = new MemoryVault();
    vault.seed("projects/项目管理说明.md", "---\ntype: 说明\n---\n- [ ] 不应写入");
    vault.seed("projects/历史项目_History/旧项目.md", "---\ntype: 项目\n---\n## 待办\n- [ ] 历史任务");
    vault.seed("projects/客户误放.md", "---\ntype: 客户\n---\n## 待办\n- [ ] 错域任务");
    const index = new EntityIndex(vault, config);
    await index.scan();
    expect(index.listEntities()).toHaveLength(0);
    expect(index.listTasks()).toHaveLength(0);
  });
});

describe("WriteTransactionExecutor", () => {
  it("commits, records, and safely undoes a write", async () => {
    const vault = new MemoryVault();
    vault.seed("a.md", "before");
    const journal = new TransactionJournal(50);
    const executor = new WriteTransactionExecutor(vault, journal, {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => "tx-1"
    });
    const receipt = await executor.execute({
      label: "change",
      operations: [{ kind: "write", path: "a.md", content: "after", expectedRevision: contentRevision("before") }]
    });
    expect(receipt.status).toBe("committed");
    expect(await vault.read("a.md")).toBe("after");
    expect(journal.list()).toHaveLength(1);
    const undo = await executor.undo(receipt.id);
    expect(undo.status).toBe("committed");
    expect(await vault.read("a.md")).toBe("before");
  });

  it("reports partial when compensation would overwrite an external edit", async () => {
    const vault = new MemoryVault();
    vault.seed("a.md", "A0");
    vault.seed("b.md", "B0");
    vault.failWrite.add("b.md");
    vault.afterWrite = (path, target) => {
      if (path === "a.md") target.seed("a.md", "external edit");
    };
    const executor = new WriteTransactionExecutor(vault);
    const receipt = await executor.execute({
      label: "two files",
      operations: [
        { kind: "write", path: "a.md", content: "A1" },
        { kind: "write", path: "b.md", content: "B1" }
      ]
    });
    expect(receipt.status).toBe("partial");
    expect(receipt.unresolvedPaths).toEqual(["a.md"]);
    expect(await vault.read("a.md")).toBe("external edit");
  });
});

describe("project tasks and meeting migration", () => {
  it("adds, completes, reschedules and protects task revisions", async () => {
    const vault = new MemoryVault();
    vault.seed("projects/a.md", "---\ntype: 项目\n---\n\n## 待办\n");
    const executor = new WriteTransactionExecutor(vault);
    const tasks = new ProjectTaskService(vault, executor);
    expect((await tasks.addTask("projects/a.md", { text: "提交方案", due: "2026-08-20", priority: "high" })).status)
      .toBe("committed");
    let current = parseSingleTask(await vault.read("projects/a.md"), "projects/a.md", "project");
    await tasks.complete(current, true, new Date(2026, 7, 10));
    current = parseSingleTask(await vault.read("projects/a.md"), "projects/a.md", "project");
    await tasks.reschedule(current, "2026-08-25");
    const finalText = await vault.read("projects/a.md");
    expect(finalText).toContain("[x] 提交方案");
    expect(finalText).toContain("📅 2026-08-25");
    expect(finalText).toMatch(/\^qwb-[a-z0-9]+$/m);
    await expect(tasks.complete(current)).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("updates due date and priority in one transaction", async () => {
    const vault = new MemoryVault();
    vault.seed("projects/a.md", "---\ntype: 项目\n---\n## 待办\n- [ ] 联合更新 📅 2026-08-20 ^joint-1");
    const executor = new WriteTransactionExecutor(vault);
    const tasks = new ProjectTaskService(vault, executor);
    const current = parseSingleTask(await vault.read("projects/a.md"), "projects/a.md", "project");
    const receipt = await tasks.update(current, { due: "2026-08-28", priority: "high" });
    expect(receipt.status).toBe("committed");
    expect(receipt.operationCount).toBe(1);
    const updated = await vault.read("projects/a.md");
    expect(updated).toContain("📅 2026-08-28");
    expect(updated).toContain("🔼 ^joint-1");
    const refreshed = parseSingleTask(updated, "projects/a.md", "project");
    await tasks.update(refreshed, { due: null });
    expect(await vault.read("projects/a.md")).not.toContain("📅");
  });

  it("migrates a meeting action once and records a stable source receipt", async () => {
    const vault = new MemoryVault();
    vault.seed("meetings/m.md", "---\ntype: 会议纪要\n---\n## 后续动作\n- [ ] 确认接口 📅 2026-08-20 ^meeting-1");
    vault.seed("projects/p.md", "---\ntype: 项目\n---\n## 待办\n");
    const executor = new WriteTransactionExecutor(vault);
    const service = new MeetingMigrationService(vault, executor);
    const source = parseSingleTask(await vault.read("meetings/m.md"), "meetings/m.md", "meeting-draft");
    const first = await service.migrate({ sourceTask: source, targetPath: "projects/p.md", targetScope: "project" });
    expect(first.outcome).toBe("migrated");
    expect(await vault.read("projects/p.md")).toContain("quiet-workbench:source");
    const refreshed = parseSingleTask(await vault.read("meetings/m.md"), "meetings/m.md", "meeting-draft");
    const second = await service.migrate({ sourceTask: refreshed, targetPath: "projects/p.md", targetScope: "project" });
    expect(second.outcome).toBe("already-migrated");
    expect((await vault.read("projects/p.md")).match(/确认接口/g)).toHaveLength(1);
  });
});

function parseSingleTask(content: string, path: string, scope: TaskRecord["scope"]): TaskRecord {
  const task = parseMarkdown(content, { path, sourceName: path, scope }).tasks[0];
  if (!task) throw new Error("Expected a task fixture.");
  return task;
}
