import { TASK_PATTERN } from "../domain/markdown";

export interface TasksApiV1 {
  createTaskLineModal(): Promise<string>;
  editTaskLineModal(taskLine: string): Promise<string>;
  executeToggleTaskDoneCommand(taskLine: string, filePath: string): string;
}

export type TasksModalResult =
  | { status: "unavailable" }
  | { status: "cancelled" }
  | { status: "submitted"; text: string };

export class TasksApiAdapter {
  constructor(private readonly resolveApi: () => TasksApiV1 | undefined) {}

  isAvailable(): boolean {
    return this.api() !== undefined;
  }

  async createTaskLine(): Promise<TasksModalResult> {
    const api = this.api();
    if (!api) return { status: "unavailable" };
    let raw: string;
    try {
      raw = await api.createTaskLineModal();
    } catch (error) {
      console.warn("Asterism: Tasks create modal failed; using core fallback", error);
      return { status: "unavailable" };
    }
    const text = normalizeTaskLines(raw);
    return text ? { status: "submitted", text } : { status: "cancelled" };
  }

  async editTaskLine(taskLine: string): Promise<TasksModalResult> {
    const api = this.api();
    if (!api) return { status: "unavailable" };
    let raw: string;
    try {
      raw = await api.editTaskLineModal(taskLine);
    } catch (error) {
      console.warn("Asterism: Tasks edit modal failed; using core fallback", error);
      return { status: "unavailable" };
    }
    const text = normalizeTaskLines(raw);
    return text ? { status: "submitted", text } : { status: "cancelled" };
  }

  toggleTask(taskLine: string, filePath: string): string | undefined {
    const api = this.api();
    if (!api) return undefined;
    try {
      return normalizeTaskLines(api.executeToggleTaskDoneCommand(taskLine, filePath)) || undefined;
    } catch (error) {
      console.warn("Asterism: Tasks toggle failed; using core fallback", error);
      return undefined;
    }
  }

  private api(): TasksApiV1 | undefined {
    try {
      return this.resolveApi();
    } catch (error) {
      console.warn("Asterism: Tasks API lookup failed", error);
      return undefined;
    }
  }
}

export function isTasksApiV1(value: unknown): value is TasksApiV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TasksApiV1>;
  return typeof candidate.createTaskLineModal === "function"
    && typeof candidate.editTaskLineModal === "function"
    && typeof candidate.executeToggleTaskDoneCommand === "function";
}

function normalizeTaskLines(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  if (lines.some((line) => !TASK_PATTERN.test(line))) {
    throw new Error("Tasks 返回了无法识别的任务格式；未写入任何文件。");
  }
  return lines.join("\n");
}
