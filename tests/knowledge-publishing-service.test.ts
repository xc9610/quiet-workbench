import { describe, expect, it } from "vitest";
import { UnsupportedTemplateExpressionError } from "../src/services/template-service";
import {
  KnowledgePublicationConflictError,
  KnowledgePublicationPlanner,
  KnowledgeSourceAlreadyPublishedError,
  normalizeKnowledgeTargetPath,
  sanitizeKnowledgeTitle
} from "../src/services/knowledge-publishing-service";
import { WriteTransactionExecutor } from "../src/services/transaction-service";
import type { VaultFileInfo, VaultPort } from "../src/services/vault-port";

class MemoryVault implements VaultPort {
  readonly files = new Map<string, { content: string; mtime: number }>();
  private clock = 1;

  seed(path: string, content: string): void {
    this.files.set(path, { content, mtime: this.clock++ });
  }

  async listMarkdownFiles(folder: string): Promise<VaultFileInfo[]> {
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(`${folder}/`) && path.endsWith(".md"))
      .map(([path, value]) => ({ path, mtime: value.mtime, size: value.content.length }));
  }

  async read(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing: ${path}`);
    return file.content;
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`Missing: ${path}`);
    this.files.set(path, { content, mtime: this.clock++ });
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

describe("KnowledgePublicationPlanner", () => {
  it("builds a previewable two-file plan while preserving the source body and template", async () => {
    const vault = new MemoryVault();
    const source = [
      "---",
      "title: 原始素材",
      "triage_status: 待沉淀",
      "project:",
      "  - [[旧项目]]",
      "source_custom: keep-source",
      "---",
      "原始正文第一段。",
      "",
      "## 原始章节",
      "保留这里。"
    ].join("\n");
    const template = [
      "---",
      "type: 知识",
      "template_custom: keep-template",
      "created: <% tp.date.now(\"YYYY-MM-DD\") %>",
      "---",
      "# <% tp.file.title %>",
      "",
      "<!-- quiet-workbench:content -->"
    ].join("\n");
    vault.seed("inbox/source.md", source);
    vault.seed("templates/knowledge.md", template);
    vault.seed("projects/p.md", "---\ntype: 项目\n---");
    const planner = new KnowledgePublicationPlanner(vault, undefined, () => "knowledge-tx-1");

    const preview = await planner.preview({
      sourcePath: "inbox/source.md",
      title: "正式/知识.md",
      targetFolder: "wiki/formal/",
      templatePath: "templates/knowledge.md",
      projectPath: "projects/p.md",
      now: new Date(2026, 7, 23, 9, 30)
    });

    expect(preview.targetPath).toBe("wiki/formal/正式-知识.md");
    expect(preview.targetContent).toContain("template_custom: keep-template");
    expect(preview.targetContent).toContain("created: 2026-08-23");
    expect(preview.targetContent).toContain("# 正式-知识");
    expect(preview.targetContent).toContain("## 原始章节\n保留这里。");
    expect(preview.targetContent).toContain('source_note: "[[inbox/source]]"');
    expect(preview.targetContent).toContain('project: "[[projects/p]]"');
    expect(preview.sourceAfter).toContain("source_custom: keep-source");
    expect(preview.sourceAfter).toContain('triage_status: "已归档"');
    expect(preview.sourceAfter).toContain('project: "[[projects/p]]"');
    expect(preview.sourceAfter).not.toContain("  - [[旧项目]]");
    expect(preview.sourceAfter).toContain('quiet_workbench_published_to: "[[wiki/formal/正式-知识]]"');
    expect(preview.plan.operations.map((operation) => operation.path)).toEqual([
      "wiki/formal/正式-知识.md",
      "inbox/source.md"
    ]);
    expect(preview.plan.operations.some((operation) => operation.path === "templates/knowledge.md")).toBe(false);
    expect(await vault.exists(preview.targetPath)).toBe(false);
    expect(await vault.read("inbox/source.md")).toBe(source);

    const receipt = await new WriteTransactionExecutor(vault).execute(preview.plan);
    expect(receipt.status).toBe("committed");
    expect(await vault.read("templates/knowledge.md")).toBe(template);
    expect(await vault.read("inbox/source.md")).toBe(preview.sourceAfter);
    expect(await vault.read(preview.targetPath)).toBe(preview.targetContent);
  });

  it("rejects exact, case-insensitive, and Unicode-equivalent duplicate targets", async () => {
    const vault = new MemoryVault();
    vault.seed("inbox/source.md", "正文");
    vault.seed("wiki/EXAMPLE.md", "existing");
    vault.seed("wiki/Café.md", "existing unicode");
    const planner = new KnowledgePublicationPlanner(vault);

    await expect(planner.preview({ sourcePath: "inbox/source.md", title: "example", targetFolder: "wiki" }))
      .rejects.toBeInstanceOf(KnowledgePublicationConflictError);
    await expect(planner.preview({ sourcePath: "inbox/source.md", title: "Cafe\u0301", targetFolder: "wiki" }))
      .rejects.toBeInstanceOf(KnowledgePublicationConflictError);
  });

  it("does not execute arbitrary Templater JavaScript", async () => {
    const vault = new MemoryVault();
    vault.seed("inbox/source.md", "正文");
    vault.seed("templates/unsafe.md", "<%* app.vault.delete('important.md') %>");
    const planner = new KnowledgePublicationPlanner(vault);

    await expect(planner.preview({
      sourcePath: "inbox/source.md",
      title: "安全目标",
      targetFolder: "wiki",
      templatePath: "templates/unsafe.md"
    })).rejects.toBeInstanceOf(UnsupportedTemplateExpressionError);
    expect(await vault.read("templates/unsafe.md")).toContain("app.vault.delete");
    expect(await vault.exists("wiki/安全目标.md")).toBe(false);
  });

  it("prevents publishing a source that already carries a durable target marker", async () => {
    const vault = new MemoryVault();
    vault.seed("inbox/source.md", [
      "---",
      "quiet_workbench_published_to: \"[[wiki/existing]]\"",
      "---",
      "正文"
    ].join("\n"));
    const planner = new KnowledgePublicationPlanner(vault);

    await expect(planner.preview({
      sourcePath: "inbox/source.md",
      title: "另一个目标",
      targetFolder: "wiki"
    })).rejects.toBeInstanceOf(KnowledgeSourceAlreadyPublishedError);
  });

  it("uses a built-in safe template and adds frontmatter to a plain source note", async () => {
    const vault = new MemoryVault();
    vault.seed("inbox/plain.md", "只有正文");
    const planner = new KnowledgePublicationPlanner(vault, undefined, () => "knowledge-tx-2");
    const preview = await planner.preview({
      sourcePath: "inbox/plain.md",
      title: "普通知识",
      targetFolder: "wiki",
      sourceStatus: "待沉淀",
      now: new Date(2026, 7, 23, 12)
    });

    expect(preview.targetContent).toContain("# 普通知识");
    expect(preview.targetContent).toContain("只有正文");
    expect(preview.sourceAfter).toMatch(/^---\n/u);
    expect(preview.sourceAfter).toContain('triage_status: "待沉淀"');
  });
});

describe("knowledge path helpers", () => {
  it("normalizes separators, invalid title characters, whitespace, and an optional extension", () => {
    expect(sanitizeKnowledgeTitle("  A/B   C.md  ")).toBe("A-B C");
    expect(sanitizeKnowledgeTitle("换行\n标题")).toBe("换行 标题");
    expect(normalizeKnowledgeTargetPath("wiki\\formal\\", "A:B.md")).toBe("wiki/formal/A-B.md");
    expect(() => normalizeKnowledgeTargetPath("../outside", "x")).toThrow("Unsafe Vault path");
  });
});
