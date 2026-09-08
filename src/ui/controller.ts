import type {
  ActivityDay,
  ContextSurface,
  EntityKind,
  LayoutItem,
  TaskRecord,
  TransactionReceipt
} from "../core/types";
import type { QuietWorkbenchSettings } from "../settings";
import type { QuickMemoEntry } from "../domain/memo";
import type { MeetingMigrationBatchResult } from "../services/meeting-migration-service";
import type { KnowledgePublicationInput, KnowledgePublicationPreview } from "../services/knowledge-publishing-service";
import type { ProjectReviewInput } from "../domain/project-review";
import type { FullCalendarSnapshot } from "../services/full-calendar-adapter";

export interface DiagnosticItem {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "warning" | "error";
}

export interface EntitySummary {
  kind: EntityKind;
  name: string;
  path: string;
  aliases?: string[];
  status?: string;
  related?: string;
  detail?: string;
  due?: string;
  startTime?: string;
  endTime?: string;
  phase?: string;
  projectType?: string;
  client?: string;
  project?: string;
  organizationType?: string;
  businessDomains?: string;
  relationshipStatus?: string;
  followupDate?: string;
  updatedAt?: number;
  owner?: string;
  businessType?: string;
  nextAction?: string;
  waitingOn?: string;
  reviewStatus?: string;
  reviewDue?: string;
  reviewNote?: string;
  reviewTrigger?: string;
}

export interface QuickMemoSnapshot {
  path: string;
  exists: boolean;
  recent: QuickMemoEntry[];
  error?: string;
}

export interface ContextSnapshot {
  surface: ContextSurface;
  path?: string;
  title: string;
  kind?: EntityKind;
  status?: string;
  relatedProjects: EntitySummary[];
  tasks: TaskRecord[];
  meetings: EntitySummary[];
}

export interface WorkbenchSnapshot {
  scannedAt?: number;
  diagnostics: DiagnosticItem[];
  projects: EntitySummary[];
  clients: EntitySummary[];
  suppliers: EntitySummary[];
  meetings: EntitySummary[];
  knowledge: EntitySummary[];
  tasks: TaskRecord[];
  activity: ActivityDay[];
  calendar: FullCalendarSnapshot;
  transactionHistory: TransactionReceipt[];
  memo: QuickMemoSnapshot;
  context: ContextSnapshot;
  lastReceipt?: TransactionReceipt;
}

export interface CreateEntityInput {
  kind: Exclude<EntityKind, "knowledge">;
  name: string;
  relatedClient?: string;
  relatedProject?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  openAfterCreate?: boolean;
}

export interface CreateNoteInput {
  title: string;
  folder?: string;
  body?: string;
  relatedClient?: string;
  relatedProject?: string;
  openAfterCreate?: boolean;
}

export interface AddProjectTaskInput {
  projectPath: string;
  text: string;
  due?: string;
  priority?: TaskRecord["priority"];
}

export interface WorkbenchController {
  readonly settings: QuietWorkbenchSettings;
  getSnapshot(): WorkbenchSnapshot;
  subscribe(listener: (snapshot: WorkbenchSnapshot) => void): () => void;
  refresh(): Promise<void>;
  openWorkbench(): Promise<void>;
  openTaskBoard(): Promise<void>;
  openProjectReview(): Promise<void>;
  openCalendar(): Promise<void>;
  openGlobalSearch(): Promise<void>;
  authorizeCalendar(): Promise<void>;
  openContextPanel(): Promise<void>;
  createBlankNote(): Promise<void>;
  createNote(input: CreateNoteInput): Promise<TransactionReceipt>;
  previewNote(input: CreateNoteInput): Promise<{ path: string; content: string }>;
  setActivePath(path?: string, surface?: ContextSurface): Promise<void>;
  openPath(path: string): Promise<void>;
  createEntity(input: CreateEntityInput): Promise<TransactionReceipt>;
  previewEntity(input: CreateEntityInput): Promise<{ path: string; content: string }>;
  addProjectTask(input: AddProjectTaskInput): Promise<TransactionReceipt>;
  tasksIntegrationAvailable(): boolean;
  addProjectTaskWithTasks(projectPath: string): Promise<"committed" | "cancelled" | "unavailable">;
  editTaskWithTasks(task: TaskRecord): Promise<"committed" | "cancelled" | "unavailable">;
  scheduleTaskInCalendar(task: TaskRecord, date: string): Promise<void>;
  updateTask(task: TaskRecord, patch: { completed?: boolean; due?: string | null; priority?: TaskRecord["priority"] }): Promise<TransactionReceipt>;
  migrateMeetingTask(task: TaskRecord, targetPath: string): Promise<TransactionReceipt | undefined>;
  migrateMeetingTasks(tasks: TaskRecord[], targetPath: string): Promise<MeetingMigrationBatchResult>;
  retryMeetingMigration(batch: MeetingMigrationBatchResult): Promise<MeetingMigrationBatchResult>;
  updateKnowledge(path: string, status: string, projectPath?: string): Promise<TransactionReceipt>;
  previewKnowledgePublication(input: KnowledgePublicationInput): Promise<KnowledgePublicationPreview>;
  publishKnowledge(preview: KnowledgePublicationPreview): Promise<TransactionReceipt>;
  appendQuickMemo(text: string): Promise<TransactionReceipt>;
  saveProjectReview(input: ProjectReviewInput): Promise<TransactionReceipt>;
  openProjectReviewInYolo(projectPath: string): Promise<void>;
  openYolo(path?: string): Promise<void>;
  saveLayout(sceneId: string, items: LayoutItem[]): Promise<void>;
  activateLayout(sceneId: string): Promise<void>;
  copyLayout(sceneId: string, name: string): Promise<string>;
  renameLayout(sceneId: string, name: string): Promise<void>;
  restoreLayout(sceneId: string): Promise<void>;
  exportLayout(sceneId: string): string;
  importLayout(payload: string): Promise<string>;
  undoLastTransaction(): Promise<TransactionReceipt | undefined>;
}

export const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  diagnostics: [],
  projects: [],
  clients: [],
  suppliers: [],
  meetings: [],
  knowledge: [],
  tasks: [],
  activity: [],
  calendar: {
    state: "unavailable",
    available: false,
    authorized: false,
    events: []
  },
  transactionHistory: [],
  memo: { path: "", exists: false, recent: [] },
  context: {
    surface: "note",
    title: "未选择笔记",
    relatedProjects: [],
    tasks: [],
    meetings: []
  }
};
