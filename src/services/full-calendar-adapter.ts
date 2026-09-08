import type { TaskRecord } from "../core/types";

export type FullCalendarIntegrationState = "unavailable" | "authorization-required" | "ready" | "error";

export interface FullCalendarEventSummary {
  id: string;
  date: string;
  title: string;
  calendarName?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  isTask: boolean;
  completed: boolean;
}

export interface FullCalendarSnapshot {
  state: FullCalendarIntegrationState;
  available: boolean;
  authorized: boolean;
  events: FullCalendarEventSummary[];
  error?: string;
}

interface FullCalendarSettings {
  tasks?: {
    backlogDateTarget?: string;
    calendarDisplayDateTarget?: string;
  };
}

interface QueryableEvent {
  id?: unknown;
  title?: unknown;
  calendarName?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  allDay?: unknown;
  isTask?: unknown;
  isCompleted?: unknown;
}

interface FullCalendarAuthorizedApi {
  getEvents(criteria: { dateRange: { startMillis: number; endMillis: number } }): Promise<QueryableEvent[]>;
  getSettings(): Promise<FullCalendarSettings>;
  openCalendar(): Promise<void> | void;
  scheduleTask(taskId: string, date: Date, allDay?: boolean): Promise<void>;
  validateTaskSchedule?(taskId: string, date: Date, allDay?: boolean): Promise<{ valid: boolean; reason?: string }>;
}

interface FullCalendarPublicApi {
  requestAccess(pluginId: string, reason: string, scopes: string[]): Promise<string>;
  withToken(token: string): FullCalendarAuthorizedApi;
}

export interface FullCalendarPluginAccess {
  api?: FullCalendarPublicApi;
}

export interface FullCalendarAdapterOptions {
  resolvePlugin(): FullCalendarPluginAccess | undefined;
  getToken(): string;
  saveToken(token: string): Promise<void>;
  executeOpenCommand?(): boolean;
}

const SCOPES = ["events:read", "events:write", "ui:open-calendar", "settings:read"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export class FullCalendarAdapter {
  constructor(private readonly options: FullCalendarAdapterOptions) {}

  isAvailable(): boolean {
    return Boolean(this.options.resolvePlugin()?.api);
  }

  async snapshot(start: Date, end: Date): Promise<FullCalendarSnapshot> {
    const plugin = this.options.resolvePlugin();
    if (!plugin?.api) return emptySnapshot("unavailable");
    const token = this.options.getToken().trim();
    if (!token) return emptySnapshot("authorization-required", true);
    try {
      const rows = await plugin.api.withToken(token).getEvents({
        dateRange: { startMillis: start.getTime(), endMillis: end.getTime() }
      });
      return {
        state: "ready",
        available: true,
        authorized: true,
        events: rows.map(normalizeEvent).filter((event): event is FullCalendarEventSummary => Boolean(event))
      };
    } catch (error) {
      if (isAuthorizationError(error)) {
        await this.options.saveToken("");
        return emptySnapshot("authorization-required", true, errorMessage(error));
      }
      return { ...emptySnapshot("error", true), authorized: true, error: errorMessage(error) };
    }
  }

  async authorize(): Promise<void> {
    const api = this.requirePublicApi();
    const token = await api.requestAccess(
      "quiet-workbench",
      "在 Asterism 中查看日程，并把 Tasks 任务安排到计划日期",
      SCOPES
    );
    if (!token?.trim()) throw new Error("Full Calendar 未返回授权令牌。");
    await this.options.saveToken(token.trim());
  }

  async openCalendar(): Promise<void> {
    const plugin = this.options.resolvePlugin();
    const token = this.options.getToken().trim();
    if (plugin?.api && token) {
      try {
        await plugin.api.withToken(token).openCalendar();
        return;
      } catch (error) {
        if (isAuthorizationError(error)) await this.options.saveToken("");
      }
    }
    if (this.options.executeOpenCommand?.()) return;
    if (!plugin?.api) throw new Error("尚未安装或启用 Full Calendar Remastered。");
    await this.authorize();
    await this.requireAuthorizedApi().openCalendar();
  }

  async scheduleTask(task: TaskRecord, date: string): Promise<void> {
    if (task.scope === "meeting-draft") throw new Error("会议草稿需先迁移，再安排到日程。");
    if (!DATE_PATTERN.test(date) || Number.isNaN(parseLocalDate(date).getTime())) throw new Error("请选择有效的计划日期。");
    const api = await this.authorizedApiWithPrompt();
    const settings = await api.getSettings();
    const tasks = settings.tasks;
    if (tasks?.backlogDateTarget !== "scheduledDate" || tasks?.calendarDisplayDateTarget !== "scheduledDate") {
      throw new Error("Full Calendar 的 Tasks 日期映射不是“计划日期”。请在其设置中把 Backlog 和日历显示日期都设为 Scheduled Date，避免改写任务截止日期。");
    }
    const taskId = `${task.path}::${Math.max(0, task.line - 1)}`;
    const planned = parseLocalDate(date);
    const validation = await api.validateTaskSchedule?.(taskId, planned, true);
    if (validation && !validation.valid) throw new Error(validation.reason || "Full Calendar 无法安排这条任务。");
    await api.scheduleTask(taskId, planned, true);
  }

  private requirePublicApi(): FullCalendarPublicApi {
    const api = this.options.resolvePlugin()?.api;
    if (!api) throw new Error("尚未安装或启用 Full Calendar Remastered。");
    return api;
  }

  private requireAuthorizedApi(): FullCalendarAuthorizedApi {
    const token = this.options.getToken().trim();
    if (!token) throw new Error("尚未授权 Full Calendar。");
    return this.requirePublicApi().withToken(token);
  }

  private async authorizedApiWithPrompt(): Promise<FullCalendarAuthorizedApi> {
    if (!this.options.getToken().trim()) await this.authorize();
    try {
      return this.requireAuthorizedApi();
    } catch (error) {
      await this.options.saveToken("");
      throw error;
    }
  }
}

function normalizeEvent(raw: QueryableEvent, index: number): FullCalendarEventSummary | undefined {
  const date = dateString(raw.date);
  const title = text(raw.title);
  if (!date || !title) return undefined;
  return {
    id: text(raw.id) || `full-calendar:${date}:${title}:${index}`,
    date,
    title,
    calendarName: text(raw.calendarName) || undefined,
    startTime: text(raw.startTime) || undefined,
    endTime: text(raw.endTime) || undefined,
    allDay: Boolean(raw.allDay),
    isTask: Boolean(raw.isTask),
    completed: Boolean(raw.isCompleted)
  };
}

function dateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateKey(value);
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : localDateKey(date);
  }
  if (typeof value !== "string") return "";
  const match = value.match(/^\d{4}-\d{2}-\d{2}/u);
  return match?.[0] ?? "";
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptySnapshot(state: FullCalendarIntegrationState, available = false, error?: string): FullCalendarSnapshot {
  return { state, available, authorized: state === "ready", events: [], error };
}

function isAuthorizationError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("token") || message.includes("authoriz") || message.includes("permission") || message.includes("access denied");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
