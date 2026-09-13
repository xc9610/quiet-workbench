import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/core/types";
import {
  buildProjectReviewAiPrompt,
  buildProjectReviewEvidence,
  PROJECT_DEVELOPMENT_STAGES,
  projectReviewCandidates,
  reconcileProjectReviewQueue,
  projectStatusForDecision,
  projectTypeForDecision,
  projectReviewTriggers,
  serializeProjectReviewEvidence
} from "../src/domain/project-review";
import { ProjectReviewService } from "../src/services/project-review-service";
import { WriteTransactionExecutor } from "../src/services/transaction-service";
import type { VaultFileInfo, VaultPort } from "../src/services/vault-port";
import type { EntitySummary } from "../src/ui/controller";

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
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<VaultFileInfo | undefined> {
    const file = this.files.get(path);
    return file ? { path, mtime: file.mtime, size: file.content.length } : undefined;
  }
}

function project(patch: Partial<EntitySummary> = {}): EntitySummary {
  return {
    kind: "project",
    name: "热控设计",
    path: "projects/热控设计.md",
    status: "推进中",
    ...patch
  };
}

function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task",
    scope: "project",
    path: "projects/热控设计.md",
    line: 10,
    text: "完成接口评审",
    completed: false,
    sourceName: "热控设计",
    revision: "r1",
    ...patch
  };
}

describe("project review evidence", () => {
  it("derives review triggers and a stable candidate order", () => {
    const active = project({ reviewStatus: "待审议", reviewTrigger: "报价冻结", reviewDue: "2026-08-30" });
    const overdue = project({ name: "逾期项目", path: "projects/逾期.md", nextAction: "跟进客户" });
    const overdueTask = task({ path: "projects/逾期.md", due: "2026-08-20" });
    expect(projectReviewTriggers(active, "2026-08-29")).toEqual(["报价冻结", "缺少明确下一步"]);
    expect(projectReviewTriggers(overdue, "2026-08-29", [overdueTask])).toEqual(["1 项任务逾期"]);
    expect(projectReviewCandidates([active, overdue], "2026-08-29", [overdueTask]).map((entry) => entry.name)).toEqual(["热控设计", "逾期项目"]);
    expect(projectStatusForDecision("停止")).toBe("归档");
    expect(projectTypeForDecision("赢单转交付", "售前方案")).toBe("合同交付");
  });

  it("excludes closed projects and reviews active projects that have gone stale", () => {
    const stale = project({ nextAction: "等待下一轮设计输入", updatedAt: new Date(2026, 7, 1).getTime() });
    const paused = project({ status: "暂停", updatedAt: new Date(2026, 7, 1).getTime() });
    const pausedTask = task({ due: "2026-08-01" });
    const closed = project({ status: "已完成", reviewStatus: "待审议", reviewDue: "2026-08-01" });
    expect(projectReviewTriggers(stale, "2026-08-29")).toEqual(["超过 14 天没有更新"]);
    expect(projectReviewTriggers(paused, "2026-08-29", [pausedTask])).toEqual([]);
    expect(projectReviewTriggers(closed, "2026-08-29")).toEqual([]);
  });

  it("keeps evidence scoped to the selected project and related meetings", () => {
    const evidence = buildProjectReviewEvidence(
      project({ due: "2026-08-28", detail: "完成热设计评审" }),
      [
        task({ id: "late", due: "2026-08-28" }),
        task({ id: "soon", due: "2026-09-01", text: "等待客户确认" }),
        task({ id: "other", path: "projects/其他.md" })
      ],
      [
        { kind: "meeting", name: "设计评审会", path: "meetings/review.md", project: "[[热控设计]]" },
        { kind: "meeting", name: "其他会议", path: "meetings/other.md", project: "[[其他项目]]" }
      ],
      "2026-08-29",
      Date.UTC(2026, 7, 29),
      [
        { kind: "knowledge", name: "热控方案说明", path: "assets/热控方案说明.md", project: "[[projects/热控设计]]" },
        { kind: "knowledge", name: "其他方案", path: "assets/其他方案.md", project: "[[其他项目]]" }
      ]
    );
    expect(evidence.tasks).toHaveLength(2);
    expect(evidence.overdueTasks.map((entry) => entry.id)).toEqual(["late"]);
    expect(evidence.upcomingTasks.map((entry) => entry.id)).toEqual(["soon"]);
    expect(evidence.waitingTasks.map((entry) => entry.id)).toEqual(["soon"]);
    expect(evidence.meetings.map((entry) => entry.name)).toEqual(["设计评审会"]);
    expect(evidence.assets.map((entry) => entry.name)).toEqual(["热控方案说明"]);
    expect(evidence.health.reasons).not.toContain("项目目标日期已过");
  });

  it("does not treat cancelled Tasks items as unfinished project work", () => {
    const cancelled = task({ completed: true, cancelled: true, due: "2026-08-01" });
    const evidence = buildProjectReviewEvidence(project({ nextAction: "确认后续范围" }), [cancelled], [], "2026-08-29");
    expect(evidence.openTasks).toEqual([]);
    expect(evidence.overdueTasks).toEqual([]);
    expect(evidence.health.completed).toBe(0);
    expect(evidence.health.progress).toBe(0);
  });

  it("builds a bounded read-only evidence package for the YOLO skill", () => {
    const evidence = buildProjectReviewEvidence(
      project({ client: "晨星实验室", due: "2026-08-28", nextAction: "补齐试验数据" }),
      [task({ due: "2026-08-28", priority: "high" })],
      [{ kind: "meeting", name: "设计评审会", path: "meetings/review.md", project: "[[热控设计]]" }],
      "2026-08-29",
      Date.UTC(2026, 7, 29),
      [{ kind: "knowledge", name: "热控方案说明", path: "assets/热控方案说明.md", project: "[[projects/热控设计]]" }]
    );
    const prompt = buildProjectReviewAiPrompt(evidence, "2026-08-29");
    const payload = serializeProjectReviewEvidence(evidence, "2026-08-29");
    expect(prompt).toContain("project-review");
    expect(prompt).toContain("不要把审阅当成一次性处理");
    expect(prompt).toContain("不要修改任何文件");
    expect(payload).toContain("# Asterism 项目审阅证据包");
    expect(payload).toContain("- 客户：晨星实验室");
    expect(payload).not.toContain("截止日期");
    expect(payload).toContain("完成接口评审｜2026-08-28｜high");
    expect(payload).toContain("设计评审会｜meetings/review.md");
    expect(payload).toContain("## 关联方案与资料");
    expect(payload).toContain("热控方案说明｜assets/热控方案说明.md");
  });
});

describe("ProjectReviewService", () => {
  it("keeps the active project selected when an immediate task update removes its queue trigger", () => {
    expect(reconcileProjectReviewQueue(
      ["projects/active.md", "projects/next.md"],
      ["projects/next.md"],
      "projects/active.md"
    )).toEqual(["projects/active.md", "projects/next.md"]);
  });

  it("uses a concise thermal-control development vocabulary", () => {
    expect(PROJECT_DEVELOPMENT_STAGES).toEqual([
      "方案定义",
      "设计定型",
      "投产制造",
      "集成实施",
      "试验验证",
      "在轨运行"
    ]);
  });

  it("updates review metadata and appends a trace without changing the project template", async () => {
    const vault = new MemoryVault();
    const original = [
      "---",
      "type: 项目",
      "status: 推进中",
      "custom_field: keep-me",
      "review_due: 2026-08-01",
      "---",
      "# 热控设计",
      "",
      "## 项目概况",
      "模板正文保持不变。",
      "",
      "## 推进记录",
      "",
      "| 日期 | 摘要 |",
      "|---|---|",
      "| 2026-08-20 | 完成初审 |",
      "",
      "## 待办",
      "- [ ] 下一步"
    ].join("\n");
    vault.seed("projects/热控设计.md", original);
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));

    const receipt = await service.save({
      projectPath: "projects/热控设计.md",
      decision: "附条件通过",
      reviewDue: "2026-09-15",
      note: "补齐试验数据",
      phase: "试验验证",
      nextAction: "完成热真空试验",
      tasks: [
        { text: "准备热真空试验数据", due: "2026-09-10" },
        { text: "确认试验件状态" }
      ]
    }, new Date(2026, 7, 29, 12));

    const after = await vault.read("projects/热控设计.md");
    expect(receipt.status).toBe("committed");
    expect(after).toContain("custom_field: keep-me");
    expect(after).toContain('review_status: "附条件通过"');
    expect(after).toContain('status: "推进中"');
    expect(after).toContain('phase: "试验验证"');
    expect(after).toContain('next_action: "完成热真空试验"');
    expect(after).toContain('review_due: "2026-09-15"');
    expect(after).toContain('review_note: "补齐试验数据"');
    expect(after).toContain('last_review: "2026-08-29"');
    expect(after).toContain("模板正文保持不变。");
    expect(after).toContain("- 2026-08-29：项目审阅结论为「附条件通过」；状态更新为「推进中」；研制阶段「试验验证」；下一步：完成热真空试验；补齐试验数据；复审 2026-09-15");
    expect(after).toContain("- [ ] 准备热真空试验数据 📅 2026-09-10 ^qwb-");
    expect(after).toContain("- [ ] 确认试验件状态 ^qwb-");
    expect(after).toContain("| 2026-08-20 | 完成初审 |");
  });

  it("rejects conditional approval without a review date before writing", async () => {
    const vault = new MemoryVault();
    const original = "---\ntype: 项目\n---\n# 项目";
    vault.seed("projects/热控设计.md", original);
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));

    await expect(service.save({ projectPath: "projects/热控设计.md", decision: "附条件通过" }))
      .rejects.toThrow("复审日期");
    expect(await vault.read("projects/热控设计.md")).toBe(original);
  });

  it("requires a review date when pausing a project", async () => {
    const vault = new MemoryVault();
    const original = "---\ntype: 项目\n---\n# 项目";
    vault.seed("projects/热控设计.md", original);
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));

    await expect(service.save({ projectPath: "projects/热控设计.md", decision: "暂缓" }))
      .rejects.toThrow("暂缓需要填写复审日期");
    expect(await vault.read("projects/热控设计.md")).toBe(original);
  });

  it("requires an executable action before continuing a project", async () => {
    const vault = new MemoryVault();
    const original = "---\ntype: 项目\n---\n# 项目";
    vault.seed("projects/热控设计.md", original);
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));

    await expect(service.save({ projectPath: "projects/热控设计.md", decision: "已通过" }))
      .rejects.toThrow("填写下一步或新增至少一条任务");
    expect(await vault.read("projects/热控设计.md")).toBe(original);
  });

  it("converts a won pre-sales project to contract delivery in one review write", async () => {
    const vault = new MemoryVault();
    vault.seed("projects/方案.md", [
      "---",
      "type: 项目",
      "project_type: 售前方案",
      "status: 推进中",
      "phase: 方案定义",
      "---",
      "# 方案",
      "",
      "## 推进记录"
    ].join("\n"));
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));
    await service.save({
      projectPath: "projects/方案.md",
      decision: "赢单转交付",
      currentProjectType: "售前方案",
      phase: "方案定义",
      nextAction: "召开项目启动会",
      note: "合同已确认"
    }, new Date(2026, 8, 13, 12));
    const after = await vault.read("projects/方案.md");
    expect(after).toContain('project_type: "合同交付"');
    expect(after).toContain('status: "推进中"');
    expect(after).toContain('review_status: "赢单转交付"');
    expect(after).toContain("项目类型由「售前方案」转为「合同交付」");
    expect(after).toContain("下一步：召开项目启动会");
  });

  it("rejects a contract conversion for a non-sales project", async () => {
    const vault = new MemoryVault();
    const original = "---\ntype: 项目\nproject_type: 内部研发\n---\n# 项目";
    vault.seed("projects/研发.md", original);
    const service = new ProjectReviewService(vault, new WriteTransactionExecutor(vault));
    await expect(service.save({
      projectPath: "projects/研发.md",
      decision: "赢单转交付",
      currentProjectType: "内部研发"
    })).rejects.toThrow("售前方案");
    expect(await vault.read("projects/研发.md")).toBe(original);
  });
});
