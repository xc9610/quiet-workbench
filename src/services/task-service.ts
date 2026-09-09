import type { TaskRecord } from "../core/types";
import type { DetailedTransactionReceipt } from "../domain/transactions";
import {
  TASK_PATTERN,
  appendToSection,
  contentRevision,
  parseMarkdown,
  stableHash,
  type ParsedTask
} from "../domain/markdown";
import { RevisionConflictError } from "../domain/transactions";
import { WriteTransactionExecutor } from "./transaction-service";
import { TasksApiAdapter } from "./tasks-api-adapter";
import type { VaultPort } from "./vault-port";

export interface AddProjectTaskInput {
  text: string;
  due?: string;
  scheduled?: string;
  priority?: NonNullable<TaskRecord["priority"]>;
  heading?: string;
  blockId?: string;
}

export type TasksWriteResult =
  | { status: "unavailable" | "cancelled" }
  | { status: "committed"; receipt: DetailedTransactionReceipt };

export class ProjectTaskService {
  constructor(
    private readonly vault: VaultPort,
    private readonly transactions: WriteTransactionExecutor,
    private readonly tasksApi?: TasksApiAdapter
  ) {}

  isTasksIntegrationAvailable(): boolean {
    return this.tasksApi?.isAvailable() ?? false;
  }

  async addTask(path: string, input: AddProjectTaskInput): Promise<DetailedTransactionReceipt> {
    const before = await this.vault.read(path);
    const text = sanitizeTaskText(input.text);
    if (!text) throw new Error("Task text cannot be empty.");
    validateOptionalDate(input.due, "due");
    validateOptionalDate(input.scheduled, "scheduled");
    const blockId = validateBlockId(input.blockId) ?? createBlockId(path, before, text);
    const line = renderTaskLine({ ...input, text, blockId });
    const after = appendToSection(before, input.heading ?? "## 待办", line);
    return this.transactions.execute({
      label: `Add task to ${path}`,
      operations: [{ kind: "write", path, content: after, expectedRevision: contentRevision(before) }]
    });
  }

  async addTaskWithTasks(path: string, heading = "## 待办"): Promise<TasksWriteResult> {
    const modal = await this.tasksApi?.createTaskLine() ?? { status: "unavailable" as const };
    if (modal.status !== "submitted") return modal;
    const before = await this.vault.read(path);
    const taskLines = ensureTaskBlockIds(modal.text, path, before);
    const after = appendToSection(before, heading, taskLines);
    const receipt = await this.transactions.execute({
      label: `Add Tasks task to ${path}`,
      operations: [{ kind: "write", path, content: after, expectedRevision: contentRevision(before) }]
    });
    return { status: "committed", receipt };
  }

  async editTaskWithTasks(task: TaskRecord): Promise<TasksWriteResult> {
    if (!this.tasksApi?.isAvailable()) return { status: "unavailable" };
    const current = await this.readCurrentTask(task);
    const modal = await this.tasksApi.editTaskLine(current.raw);
    if (modal.status !== "submitted") return modal;
    const replacement = preserveExpectedBlockId(modal.text, current.blockId);
    const receipt = await this.mutate(task, () => replacement, "Edit task with Tasks");
    return { status: "committed", receipt };
  }

  async complete(task: TaskRecord, completed = true, completedOn = new Date()): Promise<DetailedTransactionReceipt> {
    return this.mutate(task, (raw, current) => {
      if (current.completed === completed) return raw;
      return this.tasksApi?.toggleTask(raw, task.path) ?? renderCompletion(raw, completed, completedOn);
    }, completed ? "Complete task" : "Reopen task");
  }

  async reschedule(task: TaskRecord, due?: string): Promise<DetailedTransactionReceipt> {
    validateOptionalDate(due, "due");
    return this.mutate(task, (raw) => preserveBlockId(raw, (withoutBlock) => {
      const updated = withoutBlock.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/gu, "").trimEnd();
      return due ? `${updated} 📅 ${due}` : updated;
    }), "Reschedule task");
  }

  async setPriority(
    task: TaskRecord,
    priority: NonNullable<TaskRecord["priority"]> = "normal"
  ): Promise<DetailedTransactionReceipt> {
    return this.mutate(task, (raw) => preserveBlockId(raw, (withoutBlock) => {
      const updated = withoutBlock.replace(/\s*(?:⏫|🔺|🔼|🔽|⏬|🔻)/gu, "").trimEnd();
      const emoji = priorityEmoji(priority);
      return emoji ? `${updated} ${emoji}` : updated;
    }), "Change task priority");
  }

  async update(
    task: TaskRecord,
    patch: { completed?: boolean; due?: string | null; scheduled?: string | null; priority?: TaskRecord["priority"] },
    completedOn = new Date()
  ): Promise<DetailedTransactionReceipt> {
    if (patch.completed === undefined && patch.due === undefined && patch.scheduled === undefined && patch.priority === undefined) {
      throw new Error("Task update has no changed fields.");
    }
    validateOptionalDate(patch.due ?? undefined, "due");
    validateOptionalDate(patch.scheduled ?? undefined, "scheduled");
    return this.mutate(task, (raw, current) => {
      let updated = raw;
      if (patch.scheduled !== undefined) {
        updated = preserveBlockId(updated, (withoutBlock) => {
          const withoutScheduled = withoutBlock.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/gu, "").trimEnd();
          return patch.scheduled ? `${withoutScheduled} ⏳ ${patch.scheduled}` : withoutScheduled;
        });
      }
      if (Object.prototype.hasOwnProperty.call(patch, "due")) {
        updated = preserveBlockId(updated, (withoutBlock) => {
          const withoutDue = withoutBlock.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/gu, "").trimEnd();
          return patch.due ? `${withoutDue} 📅 ${patch.due}` : withoutDue;
        });
      }
      if (patch.priority !== undefined) {
        updated = preserveBlockId(updated, (withoutBlock) => {
          const withoutPriority = withoutBlock.replace(/\s*(?:⏫|🔺|🔼|🔽|⏬|🔻)/gu, "").trimEnd();
          const emoji = priorityEmoji(patch.priority ?? "normal");
          return emoji ? `${withoutPriority} ${emoji}` : withoutPriority;
        });
      }
      if (patch.completed !== undefined && current.completed !== patch.completed) {
        updated = this.tasksApi?.toggleTask(updated, task.path) ?? renderCompletion(updated, patch.completed, completedOn);
      }
      return updated;
    }, "Update task");
  }

  private async mutate(
    task: TaskRecord,
    transform: (raw: string, current: ParsedTask) => string | Promise<string>,
    label: string
  ): Promise<DetailedTransactionReceipt> {
    const { before, parsed, current } = await this.readCurrentTaskContext(task);
    const lines = parsed.lines;
    lines[current.line - 1] = await transform(current.raw, current);
    const after = lines.join("\n");
    return this.transactions.execute({
      label: `${label}: ${task.text}`,
      operations: [{ kind: "write", path: task.path, content: after, expectedRevision: contentRevision(before) }]
    });
  }

  private async readCurrentTask(task: TaskRecord): Promise<ParsedTask> {
    return (await this.readCurrentTaskContext(task)).current;
  }

  private async readCurrentTaskContext(task: TaskRecord): Promise<{ before: string; parsed: ReturnType<typeof parseMarkdown>; current: ParsedTask }> {
    const before = await this.vault.read(task.path);
    const parsed = parseMarkdown(before, {
      path: task.path,
      sourceName: task.sourceName,
      scope: task.scope
    });
    const current = locateTask(parsed.tasks, task);
    if (!current) throw new Error(`Task is no longer present in ${task.path}.`);
    if (current.revision !== task.revision) {
      throw new RevisionConflictError(task.path, task.revision, current.revision);
    }
    return { before, parsed, current };
  }
}

export function renderTaskLine(input: AddProjectTaskInput & { text: string; blockId?: string }): string {
  validateOptionalDate(input.due, "due");
  validateOptionalDate(input.scheduled, "scheduled");
  const parts = [`- [ ] ${sanitizeTaskText(input.text)}`];
  const emoji = priorityEmoji(input.priority ?? "normal");
  if (emoji) parts.push(emoji);
  if (input.scheduled) parts.push(`⏳ ${input.scheduled}`);
  if (input.due) parts.push(`📅 ${input.due}`);
  if (input.blockId) parts.push(`^${validateBlockId(input.blockId)}`);
  return parts.join(" ");
}

export function locateTask(tasks: ParsedTask[], expected: TaskRecord): ParsedTask | undefined {
  if (expected.blockId) return tasks.find((task) => task.blockId === expected.blockId);
  return tasks.find((task) => task.line === expected.line);
}

function priorityEmoji(priority: NonNullable<TaskRecord["priority"]>): string {
  return { highest: "⏫", high: "🔼", normal: "", low: "🔽", lowest: "⏬" }[priority];
}

function sanitizeTaskText(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function validateOptionalDate(value: string | undefined, field: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  }
}

function validateBlockId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/^\^/, "");
  if (!/^[A-Za-z0-9-]+$/.test(normalized)) throw new Error("Invalid Obsidian block ID.");
  return normalized;
}

function createBlockId(path: string, content: string, text: string): string {
  return `qwb-${stableHash(`${path}\n${content.length}\n${text}`)}`;
}

function preserveBlockId(raw: string, transform: (withoutBlock: string) => string): string {
  const match = raw.match(/\s+(\^[A-Za-z0-9-]+)\s*$/u);
  const withoutBlock = match ? raw.slice(0, match.index).trimEnd() : raw;
  const transformed = transform(withoutBlock).trimEnd();
  return match ? `${transformed} ${match[1]}` : transformed;
}

function renderCompletion(raw: string, completed: boolean, completedOn: Date): string {
  return preserveBlockId(raw, (withoutBlock) => {
    const match = withoutBlock.match(TASK_PATTERN);
    if (!match) throw new Error("The target line is no longer a Markdown task.");
    let body = (match[3] ?? "").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/gu, "").trimEnd();
    if (completed) body = `${body} ✅ ${toLocalDate(completedOn)}`;
    return `${match[1] ?? ""}- [${completed ? "x" : " "}] ${body}`;
  });
}

function ensureTaskBlockIds(taskLines: string, path: string, content: string): string {
  return taskLines.split("\n").map((line, index) => {
    if (/\s+\^[A-Za-z0-9-]+\s*$/u.test(line)) return line;
    const blockId = `qwb-${stableHash(`${path}\n${content.length}\n${index}\n${line}`)}`;
    return `${line.trimEnd()} ^${blockId}`;
  }).join("\n");
}

function preserveExpectedBlockId(taskLines: string, blockId?: string): string {
  if (!blockId || new RegExp(`(?:^|\\s)\\^${escapeRegExp(blockId)}(?:\\s|$)`, "u").test(taskLines)) return taskLines;
  const lines = taskLines.split("\n");
  const last = lines.length - 1;
  lines[last] = `${lines[last]?.trimEnd() ?? ""} ^${blockId}`;
  return lines.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
