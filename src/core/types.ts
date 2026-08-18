export type EntityKind = "project" | "client" | "supplier" | "meeting" | "knowledge";
export type TaskScope = "project" | "client" | "meeting-draft";
export type WorkbenchSurface = "workbench" | "sidebar";
export type TransactionStatus =
  | "planned"
  | "preflight"
  | "committing"
  | "committed"
  | "rolled-back"
  | "partial"
  | "failed";

export interface EntityRecord {
  kind: EntityKind;
  path: string;
  name: string;
  aliases: string[];
  fields: Record<string, unknown>;
  mtime: number;
}

export interface TaskRecord {
  id: string;
  scope: TaskScope;
  path: string;
  line: number;
  text: string;
  completed: boolean;
  due?: string;
  scheduled?: string;
  priority?: "highest" | "high" | "normal" | "low" | "lowest";
  blockId?: string;
  sourceName: string;
  revision: string;
  /** A meeting action that already has a durable Quiet Workbench migration receipt. */
  migrated?: boolean;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  surfaces: WorkbenchSurface[];
  pack: EntityKind | "core" | "tasks";
  refresh: "live" | "manual";
  defaultSize: { width: number; height: number };
}

export interface LayoutItem {
  widgetId: string;
  /** Stable identity for one widget instance. Legacy layouts may omit it. */
  instanceId?: string;
  /** User-facing title for this particular instance. */
  title?: string;
  /** Optional recommended configuration used to create this instance. */
  presetId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hidden?: boolean;
  collapsed?: boolean;
  config?: Record<string, unknown>;
}

export interface LayoutSchema {
  version: 1;
  id: string;
  name: string;
  surface: WorkbenchSurface;
  items: LayoutItem[];
}

export interface TransactionReceipt {
  id: string;
  label: string;
  status: TransactionStatus;
  startedAt: string;
  completedAt?: string;
  affectedPaths: string[];
  messages: string[];
}
