import type { EntityKind, EntityRecord, TaskScope } from "../core/types";

export interface EntityDefinition {
  kind: EntityKind;
  folder: string;
  typeValues: string[];
  aliases?: Record<string, string[]>;
  allowUntyped?: boolean;
  acceptAllTypes?: boolean;
}

export interface EntityIndexConfig {
  definitions: EntityDefinition[];
}

export interface EntityIndexUpdate {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
  errors: Array<{ path: string; message: string }>;
}

export interface IndexedEntity extends EntityRecord {
  tasks: string[];
}

export function taskScopeForEntity(kind: EntityKind): TaskScope | undefined {
  if (kind === "project") return "project";
  if (kind === "client") return "client";
  if (kind === "meeting") return "meeting-draft";
  return undefined;
}

export function taskHeadingsForEntity(kind: EntityKind): string[] {
  if (kind === "project") return ["待办", "待办任务", "任务"];
  if (kind === "client") return ["待办", "待办任务", "任务"];
  if (kind === "meeting") return ["后续动作", "行动项"];
  return [];
}

export function canonicalizeFields(
  fields: Record<string, unknown>,
  aliases: Record<string, string[]> = {}
): Record<string, unknown> {
  const normalized = { ...fields };
  for (const [canonical, legacyKeys] of Object.entries(aliases)) {
    if (!isEmpty(normalized[canonical])) continue;
    const legacy = legacyKeys.find((key) => !isEmpty(fields[key]));
    if (legacy) normalized[canonical] = fields[legacy];
  }
  if (normalized.triage_status === undefined && normalized.status !== undefined) {
    normalized.triage_status = normalized.status;
  }
  return normalized;
}

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}
