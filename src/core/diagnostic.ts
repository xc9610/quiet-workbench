import type { QuietWorkbenchSettings } from "../settings";

export type DiagnosticStatus = "pass" | "warn" | "info";
export type DiagnosticCategory = "folder" | "template" | "field-alias" | "optional-plugin";

export interface DiagnosticItem {
  id: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  title: string;
  detail: string;
  path?: string;
}

export interface DiagnosticReport {
  generatedAt: string;
  readOnly: true;
  items: DiagnosticItem[];
  summary: Record<DiagnosticStatus, number>;
}

/** Read-only by construction: no create, modify, rename or delete capability. */
export interface DiagnosticVaultReader {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  listMarkdownFiles(folder: string): Promise<Array<string | { path: string }>>;
  pluginEnabled(id: string): boolean;
}

const OPTIONAL_PLUGINS = [
  { id: "dataview", title: "Dataview" },
  { id: "obsidian-tasks-plugin", title: "Tasks" },
  { id: "templater-obsidian", title: "Templater" },
  { id: "obsidian-full-calendar", title: "Full Calendar" }
] as const;

export class DiagnosticService {
  constructor(private readonly reader: DiagnosticVaultReader) {}

  async run(settings: QuietWorkbenchSettings): Promise<DiagnosticReport> {
    const items: DiagnosticItem[] = [];
    const folders = [
      ["project", "项目目录", settings.projectFolder],
      ["client", "客户目录", settings.clientFolder],
      ["meeting", "会议目录", settings.meetingFolder],
      ["supplier", "供应商目录", settings.supplierFolder],
      ["knowledge", "知识目录", settings.knowledgeFolder]
    ] as const;
    for (const [id, title, path] of folders) {
      items.push(await this.pathItem(`folder.${id}`, "folder", title, path));
    }

    for (const [id, path] of Object.entries(settings.templates)) {
      items.push(await this.pathItem(`template.${id}`, "template", `${id} 模板`, path));
    }

    items.push(...(await this.checkClientAliases(settings)));

    for (const plugin of OPTIONAL_PLUGINS) {
      const enabled = this.reader.pluginEnabled(plugin.id);
      items.push({
        id: `plugin.${plugin.id}`,
        category: "optional-plugin",
        status: "info",
        title: plugin.title,
        detail: enabled ? "已启用，可提供可选增强" : "未启用；Quiet Workbench 核心功能仍可运行"
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      items,
      summary: summarize(items)
    };
  }

  private async pathItem(
    id: string,
    category: "folder" | "template",
    title: string,
    path: string
  ): Promise<DiagnosticItem> {
    let exists = false;
    let error: string | undefined;
    try {
      exists = Boolean(path.trim()) && (await this.reader.exists(path));
    } catch (cause) {
      error = errorMessage(cause);
    }
    return {
      id,
      category,
      status: exists ? "pass" : "warn",
      title,
      detail: exists ? "已找到" : error ? `检查失败：${error}` : "未找到；请在设置中确认路径",
      path
    };
  }

  private async checkClientAliases(settings: QuietWorkbenchSettings): Promise<DiagnosticItem[]> {
    let folderExists: boolean;
    try {
      folderExists = await this.reader.exists(settings.clientFolder);
    } catch (cause) {
      return [{
        id: "aliases.client",
        category: "field-alias",
        status: "warn",
        title: "客户字段兼容",
        detail: `客户目录检查失败：${errorMessage(cause)}`,
        path: settings.clientFolder
      }];
    }
    if (!folderExists) {
      return [{
        id: "aliases.client",
        category: "field-alias",
        status: "warn",
        title: "客户字段兼容",
        detail: "客户目录不存在，无法检查字段别名",
        path: settings.clientFolder
      }];
    }

    let paths: string[];
    try {
      paths = (await this.reader.listMarkdownFiles(settings.clientFolder))
        .slice(0, 50)
        .map((entry) => typeof entry === "string" ? entry : entry.path);
    } catch (cause) {
      return [{
        id: "aliases.client",
        category: "field-alias",
        status: "warn",
        title: "客户字段兼容",
        detail: `无法列出客户文件：${errorMessage(cause)}`,
        path: settings.clientFolder
      }];
    }
    if (paths.length === 0) {
      return [{
        id: "aliases.client",
        category: "field-alias",
        status: "info",
        title: "客户字段兼容",
        detail: "客户目录中没有 Markdown 文件",
        path: settings.clientFolder
      }];
    }

    const reads = await Promise.all(paths.map(async (path) => {
      try {
        return { path, keys: frontmatterKeys(await this.reader.read(path)) };
      } catch (cause) {
        return { path, error: errorMessage(cause) };
      }
    }));
    const keySets = reads.flatMap((entry) => entry.keys ? [entry.keys] : []);
    const results = Object.entries(settings.clientAliases).map(([canonical, aliases]) => {
      const canonicalCount = keySets.filter((keys) => keys.has(canonical)).length;
      const aliasCounts = aliases.map((alias) => ({
        alias,
        count: keySets.filter((keys) => keys.has(alias)).length
      }));
      const legacyCount = aliasCounts.reduce((sum, value) => sum + value.count, 0);
      return {
        id: `alias.${canonical}`,
        category: "field-alias",
        status: canonicalCount > 0 ? "pass" : legacyCount > 0 ? "info" : "warn",
        title: canonical,
        detail: canonicalCount > 0
          ? `${canonicalCount} 个文件使用标准字段${legacyCount > 0 ? `，${legacyCount} 个仍使用兼容别名` : ""}`
          : legacyCount > 0
            ? `仅发现兼容别名：${aliasCounts.filter((entry) => entry.count > 0).map((entry) => entry.alias).join("、")}`
            : `未发现标准字段或兼容别名：${aliases.join("、")}`,
        path: settings.clientFolder
      } satisfies DiagnosticItem;
    });
    const failed = reads.filter((entry) => entry.error);
    if (failed.length > 0) {
      results.push({
        id: "aliases.client.read-errors",
        category: "field-alias",
        status: "warn",
        title: "客户字段读取",
        detail: `${failed.length} 个文件读取失败；其余文件仍已完成检查`,
        path: settings.clientFolder
      });
    }
    return results;
  }
}

export function frontmatterKeys(markdown: string): Set<string> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return new Set();
  const keys = new Set<string>();
  for (const line of match[1].split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1];
    if (key) keys.add(key);
  }
  return keys;
}

function summarize(items: DiagnosticItem[]): Record<DiagnosticStatus, number> {
  return items.reduce<Record<DiagnosticStatus, number>>(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, info: 0 }
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
