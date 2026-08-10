import type { EntityKind, EntityRecord, TaskRecord, TaskScope } from "../core/types";
import {
  canonicalizeFields,
  stringList,
  taskHeadingsForEntity,
  taskScopeForEntity,
  type EntityDefinition,
  type EntityIndexConfig,
  type EntityIndexUpdate
} from "../domain/entities";
import { basenameWithoutExtension, parseMarkdown } from "../domain/markdown";
import { isPathInsideFolder, normalizeVaultPath, type VaultFileInfo, type VaultPort } from "./vault-port";

interface CachedFile {
  mtime: number;
  entity: EntityRecord;
  tasks: TaskRecord[];
}

export class EntityIndex {
  private readonly cache = new Map<string, CachedFile>();

  constructor(private readonly vault: VaultPort, private readonly config: EntityIndexConfig) {}

  async scan(): Promise<EntityIndexUpdate> {
    const update = emptyUpdate();
    const discovered = new Map<string, VaultFileInfo>();
    for (const definition of this.config.definitions) {
      try {
        for (const file of await this.vault.listMarkdownFiles(definition.folder)) {
          if (file.path.toLowerCase().endsWith(".md")) discovered.set(file.path, file);
        }
      } catch (error) {
        update.errors.push({ path: definition.folder, message: errorMessage(error) });
      }
    }

    for (const path of this.cache.keys()) {
      if (!discovered.has(path)) {
        this.cache.delete(path);
        update.removed.push(path);
      }
    }
    for (const file of discovered.values()) {
      const cached = this.cache.get(file.path);
      if (cached?.mtime === file.mtime) {
        update.unchanged.push(file.path);
        continue;
      }
      try {
        const existed = this.cache.has(file.path);
        const indexed = await this.indexFile(file);
        if (indexed) (existed ? update.changed : update.added).push(file.path);
        else if (existed) update.removed.push(file.path);
      } catch (error) {
        update.errors.push({ path: file.path, message: errorMessage(error) });
      }
    }
    return update;
  }

  async refreshPath(path: string): Promise<EntityIndexUpdate> {
    const normalized = normalizeVaultPath(path);
    const update = emptyUpdate();
    const definition = this.definitionForPath(normalized);
    const stat = await this.vault.stat(normalized);
    if (!definition || !stat) {
      if (this.cache.delete(normalized)) update.removed.push(normalized);
      else update.unchanged.push(normalized);
      return update;
    }
    const cached = this.cache.get(normalized);
    if (cached?.mtime === stat.mtime) {
      update.unchanged.push(normalized);
      return update;
    }
    try {
      const indexed = await this.indexFile(stat);
      if (indexed) (cached ? update.changed : update.added).push(normalized);
      else if (cached) update.removed.push(normalized);
      else update.unchanged.push(normalized);
    } catch (error) {
      update.errors.push({ path: normalized, message: errorMessage(error) });
    }
    return update;
  }

  removePath(path: string): boolean {
    return this.cache.delete(normalizeVaultPath(path));
  }

  clear(): void {
    this.cache.clear();
  }

  listEntities(kind?: EntityKind): EntityRecord[] {
    return [...this.cache.values()]
      .map(({ entity }) => entity)
      .filter((entity) => kind === undefined || entity.kind === kind)
      .sort((left, right) => right.mtime - left.mtime || left.name.localeCompare(right.name, "zh-CN"));
  }

  getEntity(path: string): EntityRecord | undefined {
    return this.cache.get(normalizeVaultPath(path))?.entity;
  }

  listTasks(scope?: TaskScope): TaskRecord[] {
    return [...this.cache.values()]
      .flatMap(({ tasks }) => tasks)
      .filter((task) => scope === undefined || task.scope === scope)
      .sort((left, right) => (left.due ?? "9999-99-99").localeCompare(right.due ?? "9999-99-99") || left.path.localeCompare(right.path));
  }

  private async indexFile(file: VaultFileInfo): Promise<boolean> {
    const definition = this.definitionForPath(file.path);
    if (!definition || isExcludedEntityPath(file.path)) return false;
    const content = await this.vault.read(file.path);
    const parsed = parseMarkdown(content);
    const fields = canonicalizeFields(parsed.frontmatter?.fields ?? {}, definition.aliases);
    const declared = scalarString(fields.type).toLowerCase();
    const matchesType = definition.typeValues.some((value) => value.toLowerCase() === declared);
    if (!definition.acceptAllTypes && (!declared ? !definition.allowUntyped : !matchesType)) {
      this.cache.delete(file.path);
      return false;
    }
    const kind = definition.kind;
    const entity: EntityRecord = {
      kind,
      path: file.path,
      name: scalarString(fields.name) || scalarString(fields.title) || basenameWithoutExtension(file.path),
      aliases: stringList(fields.aliases),
      fields,
      mtime: file.mtime
    };
    const entityScope = taskScopeForEntity(kind);
    const tasks = entityScope
      ? parseMarkdown(content, {
          path: file.path,
          sourceName: entity.name,
          scope: entityScope,
          taskHeadings: taskHeadingsForEntity(kind)
        }).tasks
      : [];
    this.cache.set(file.path, { mtime: file.mtime, entity, tasks });
    return true;
  }

  private definitionForPath(path: string): EntityDefinition | undefined {
    return this.config.definitions
      .filter((definition) => isPathInsideFolder(path, definition.folder))
      .sort((left, right) => right.folder.length - left.folder.length)[0];
  }

}

function isExcludedEntityPath(path: string): boolean {
  const normalized = normalizeVaultPath(path);
  const lower = normalized.toLowerCase();
  const name = basenameWithoutExtension(normalized);
  return lower.includes("/历史项目_history/")
    || lower.includes("/history/")
    || lower.includes("/归档/")
    || lower.includes("/archive/")
    || name.startsWith("__")
    || /说明$/u.test(name)
    || name.toLowerCase() === "readme";
}

function emptyUpdate(): EntityIndexUpdate {
  return { added: [], changed: [], removed: [], unchanged: [], errors: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scalarString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return "";
}
