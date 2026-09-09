import { appendToSection, contentRevision, normalizeNewlines, parseFrontmatter, stableHash } from "../domain/markdown";
import { projectStatusForDecision, validateProjectReviewInput, type ProjectReviewInput } from "../domain/project-review";
import type { DetailedTransactionReceipt } from "../domain/transactions";
import { renderTaskLine } from "./task-service";
import { WriteTransactionExecutor } from "./transaction-service";
import { normalizeVaultPath, type VaultPort } from "./vault-port";

export class ProjectReviewService {
  constructor(private readonly vault: VaultPort, private readonly transactions: WriteTransactionExecutor) {}

  async save(input: ProjectReviewInput, now = new Date()): Promise<DetailedTransactionReceipt> {
    validateProjectReviewInput(input);
    const path = normalizeVaultPath(input.projectPath);
    const before = await this.vault.read(path);
    const date = localDate(now);
    const status = projectStatusForDecision(input.decision);
    let after = setFrontmatterFields(before, {
      status,
      phase: input.phase?.trim() || undefined,
      next_action: input.nextAction?.trim() || undefined,
      review_status: input.decision,
      last_review: date,
      review_due: input.reviewDue?.trim() || undefined,
      review_note: input.note?.trim() || undefined,
      updated: date
    });
    const trace = `- ${date}：项目审阅结论为「${input.decision}」；状态更新为「${status}」${input.phase?.trim() ? `；研制阶段「${input.phase.trim()}」` : ""}${input.nextAction?.trim() ? `；下一步：${input.nextAction.trim()}` : ""}${input.note?.trim() ? `；${input.note.trim()}` : ""}${input.reviewDue ? `；复审 ${input.reviewDue}` : ""}`;
    after = insertProgressTrace(after, trace);
    if (input.task?.text.trim()) {
      const text = input.task.text.trim();
      const blockId = `qwb-${stableHash(`${path}\n${before.length}\n${text}`)}`;
      after = appendToSection(after, "## 待办", renderTaskLine({ text, due: input.task.due, blockId }));
    }
    return this.transactions.execute({
      label: `Review project: ${path}`,
      operations: [{ kind: "write", path, content: after, expectedRevision: contentRevision(before) }]
    });
  }
}

export function insertProgressTrace(content: string, trace: string): string {
  const lines = normalizeNewlines(content).split("\n");
  if (lines.some((line) => line.trim() === trace.trim())) return lines.join("\n");
  const heading = lines.findIndex((line) => /^##\s*推进记录\s*$/u.test(line.trim()));
  if (heading < 0) return `${lines.join("\n").trimEnd()}\n\n## 推进记录\n\n${trace}\n`;
  lines.splice(heading + 1, 0, "", trace);
  return lines.join("\n");
}

function setFrontmatterFields(content: string, fields: Record<string, string | undefined>): string {
  const normalized = normalizeNewlines(content);
  const parsed = parseFrontmatter(normalized);
  if (!parsed) throw new Error("项目笔记缺少 YAML frontmatter，未执行写入。");
  const lines = normalized.split("\n");
  const header = lines.slice(1, parsed.endLine);
  for (const [key, value] of Object.entries(fields)) {
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`, "u");
    const index = header.findIndex((line) => pattern.test(line));
    if (value === undefined) {
      if (index >= 0) {
        header.splice(index, 1);
        while (index < header.length && /^\s+/u.test(header[index] ?? "")) header.splice(index, 1);
      }
      continue;
    }
    const next = `${key}: ${JSON.stringify(value)}`;
    if (index >= 0) {
      header[index] = next;
      while (index + 1 < header.length && /^\s+/u.test(header[index + 1] ?? "")) header.splice(index + 1, 1);
    } else {
      header.push(next);
    }
  }
  return ["---", ...header, "---", ...lines.slice(parsed.endLine + 1)].join("\n");
}

function localDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
