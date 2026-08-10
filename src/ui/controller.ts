import type {
  EntityKind,
  LayoutItem,
  TaskRecord,
  TransactionReceipt
} from "../core/types";
import type { QuietWorkbenchSettings } from "../settings";

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
  status?: string;
  related?: string;
  detail?: string;
  due?: string;
  phase?: string;
  updatedAt?: number;
}

export interface ContextSnapshot {
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
  transactionHistory: TransactionReceipt[];
  context: ContextSnapshot;
  lastReceipt?: TransactionReceipt;
}

export interface CreateEntityInput {
  kind: Exclude<EntityKind, "knowledge">;
  name: string;
  relatedClient?: string;
  relatedProject?: string;
  date?: string;
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
  setActivePath(path?: string): Promise<void>;
  openPath(path: string): Promise<void>;
  createEntity(input: CreateEntityInput): Promise<TransactionReceipt>;
  previewEntity(input: CreateEntityInput): Promise<{ path: string; content: string }>;
  addProjectTask(input: AddProjectTaskInput): Promise<TransactionReceipt>;
  updateTask(task: TaskRecord, patch: { completed?: boolean; due?: string | null; priority?: TaskRecord["priority"] }): Promise<TransactionReceipt>;
  migrateMeetingTask(task: TaskRecord, targetPath: string): Promise<TransactionReceipt | undefined>;
  migrateMeetingTasks(tasks: TaskRecord[], targetPath: string): Promise<TransactionReceipt[]>;
  updateKnowledge(path: string, status: string, projectPath?: string): Promise<TransactionReceipt>;
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
  transactionHistory: [],
  context: {
    title: "未选择笔记",
    relatedProjects: [],
    tasks: [],
    meetings: []
  }
};
