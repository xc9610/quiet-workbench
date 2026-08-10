import {
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";
import type { EntityKind, EntityRecord, LayoutItem, LayoutSchema, TaskRecord, TransactionReceipt } from "./core/types";
import { DiagnosticService, type DiagnosticVaultReader } from "./core/diagnostic";
import { createBuiltinWidgetRegistry } from "./core/widget-registry";
import { getDefaultLayouts, validateLayout } from "./core/layout";
import {
  EntityIndex,
  MeetingMigrationService,
  ObsidianVaultAdapter,
  ProjectTaskService,
  TemplateService,
  TransactionJournal,
  WriteTransactionExecutor,
  contentRevision,
  normalizeVaultPath,
  type DetailedTransactionReceipt,
  type VaultPort
} from "./services";
import { DEFAULT_SETTINGS, type QuietWorkbenchSettings } from "./settings";
import { QuietWorkbenchSettingTab } from "./settings-tab";
import type {
  AddProjectTaskInput,
  ContextSnapshot,
  CreateEntityInput,
  DiagnosticItem,
  EntitySummary,
  WorkbenchController,
  WorkbenchSnapshot
} from "./ui/controller";
import { EMPTY_SNAPSHOT } from "./ui/controller";
import {
  CONTEXT_PANEL_VIEW_TYPE,
  ContextPanelView
} from "./views/ContextPanelView";
import {
  WORKBENCH_VIEW_TYPE,
  WorkbenchItemView
} from "./views/WorkbenchItemView";

interface PersistedPluginData extends Partial<QuietWorkbenchSettings> {
  transactionJournal?: ReturnType<TransactionJournal["serialize"]>;
}

class ObsidianDiagnosticReader implements DiagnosticVaultReader {
  constructor(private readonly vault: VaultPort) {}

  exists(path: string): Promise<boolean> {
    return this.vault.exists(path);
  }

  read(path: string): Promise<string> {
    return this.vault.read(path);
  }

  async listMarkdownFiles(folder: string): Promise<string[]> {
    return (await this.vault.listMarkdownFiles(folder)).map((file) => file.path);
  }

  pluginEnabled(id: string): boolean {
    void id;
    return false;
  }
}

class PluginWorkbenchController implements WorkbenchController {
  private readonly listeners = new Set<(snapshot: WorkbenchSnapshot) => void>();
  private readonly vaultPort: ObsidianVaultAdapter;
  private readonly journal: TransactionJournal;
  private readonly transactions: WriteTransactionExecutor;
  private readonly tasks: ProjectTaskService;
  private readonly meetingMigrations: MeetingMigrationService;
  private readonly templates = new TemplateService();
  private readonly diagnostics: DiagnosticService;
  private index: EntityIndex;
  private indexSignature: string;
  private current: WorkbenchSnapshot = structuredClone(EMPTY_SNAPSHOT);

  constructor(private readonly plugin: QuietWorkbenchPlugin, journalData?: PersistedPluginData["transactionJournal"]) {
    this.vaultPort = new ObsidianVaultAdapter(plugin.app.vault, plugin.app.fileManager);
    this.journal = new TransactionJournal(plugin.settings.transactionLimit);
    if (journalData) {
      try {
        this.journal.hydrate(journalData);
      } catch (error) {
        console.warn("Quiet Workbench: ignored invalid transaction journal", error);
      }
    }
    this.transactions = new WriteTransactionExecutor(this.vaultPort, this.journal);
    this.tasks = new ProjectTaskService(this.vaultPort, this.transactions);
    this.meetingMigrations = new MeetingMigrationService(this.vaultPort, this.transactions);
    this.diagnostics = new DiagnosticService(new ObsidianDiagnosticReader(this.vaultPort));
    this.index = this.createIndex();
    this.indexSignature = this.makeIndexSignature();
  }

  get settings(): QuietWorkbenchSettings {
    return this.plugin.settings;
  }

  getSnapshot(): WorkbenchSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: WorkbenchSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    const nextSignature = this.makeIndexSignature();
    if (nextSignature !== this.indexSignature) {
      this.index = this.createIndex();
      this.indexSignature = nextSignature;
    }
    const [update, report] = await Promise.all([
      this.index.scan(),
      this.diagnostics.run(this.plugin.settings)
    ]);
    const diagnostics: DiagnosticItem[] = report.items.map((item) => ({
      id: item.id,
      label: item.title,
      detail: item.path ? `${item.detail} · ${item.path}` : item.detail,
      status: item.status === "pass" ? "ok" : item.status === "warn" ? "warning" : "ok"
    }));
    diagnostics.push(
      ...update.errors.map((error, index) => ({
        id: `index.${index}`,
        label: "索引失败",
        detail: `${error.path} · ${error.message}`,
        status: "error" as const
      }))
    );
    this.current = {
      ...this.current,
      scannedAt: Date.now(),
      diagnostics,
      projects: this.summaries("project").filter((entry) => !isClosedStatus(entry.status)),
      clients: this.summaries("client"),
      suppliers: this.summaries("supplier"),
      meetings: this.summaries("meeting"),
      knowledge: this.summaries("knowledge"),
      tasks: this.index.listTasks(),
      transactionHistory: this.journal.list(),
      context: this.buildContext(this.current.context.path)
    };
    this.emit();
  }

  async setActivePath(path?: string): Promise<void> {
    this.current = { ...this.current, context: this.buildContext(path) };
    this.emit();
  }

  async openPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
    await this.plugin.app.workspace.getLeaf(false).openFile(file);
  }

  async createEntity(input: CreateEntityInput): Promise<TransactionReceipt> {
    this.requireWrites();
    const { path, content } = await this.previewEntity(input);
    const receipt = await this.transactions.execute({
      label: `Create ${input.kind}: ${sanitizeTitle(input.name)}`,
      operations: [{ kind: "create", path, content }]
    });
    await this.afterReceipt(receipt, path);
    if (receipt.status === "committed" && input.openAfterCreate !== false) await this.openPath(path);
    return receipt;
  }

  async previewEntity(input: CreateEntityInput): Promise<{ path: string; content: string }> {
    const name = sanitizeTitle(input.name);
    const folder = this.folderForKind(input.kind);
    const templatePath = this.plugin.settings.templates[input.kind];
    const templateFile = this.plugin.app.vault.getAbstractFileByPath(normalizePath(templatePath));
    if (!(templateFile instanceof TFile)) throw new Error(`模板不存在：${templatePath}`);
    const template = await this.plugin.app.vault.read(templateFile);
    const stem = input.kind === "meeting" && input.date ? `${input.date} ${name}` : name;
    let content = this.templates.render(template, { title: stem, now: parseDate(input.date) });
    content = applyEntityContext(content, input);
    const path = normalizeVaultPath(`${folder}/${stem}.md`);
    return { path, content };
  }

  async addProjectTask(input: AddProjectTaskInput): Promise<TransactionReceipt> {
    this.requireWrites();
    const receipt = await this.tasks.addTask(input.projectPath, {
      text: input.text,
      due: input.due,
      priority: input.priority
    });
    await this.afterReceipt(receipt, input.projectPath);
    return receipt;
  }

  async updateTask(task: TaskRecord, patch: { completed?: boolean; due?: string | null; priority?: TaskRecord["priority"] }): Promise<TransactionReceipt> {
    this.requireWrites();
    const receipt = await this.tasks.update(task, patch);
    await this.afterReceipt(receipt, task.path);
    return receipt;
  }

  async migrateMeetingTask(task: TaskRecord, targetPath: string): Promise<TransactionReceipt | undefined> {
    this.requireWrites();
    const result = await this.meetingMigrations.migrate({ sourceTask: task, targetPath, targetScope: this.migrationTargetScope(targetPath) });
    if (!result.receipt) {
      await this.index.refreshPath(task.path);
      await this.refresh();
      return undefined;
    }
    await this.index.refreshPath(task.path);
    await this.afterReceipt(result.receipt, targetPath);
    return result.receipt;
  }

  async migrateMeetingTasks(tasks: TaskRecord[], targetPath: string): Promise<TransactionReceipt[]> {
    this.requireWrites();
    const receipts: TransactionReceipt[] = [];
    let processed = 0;
    let failure: string | undefined;
    try {
      for (const task of tasks) {
        const result = await this.meetingMigrations.migrate({ sourceTask: task, targetPath, targetScope: this.migrationTargetScope(targetPath) });
        if (result.receipt) receipts.push(result.receipt);
        if (result.outcome === "migrated" || result.outcome === "already-migrated") processed += 1;
        if (result.receipt?.status !== "committed" && result.outcome !== "already-migrated") {
          const unresolved = result.receipt?.unresolvedPaths.length ? `；未恢复：${result.receipt.unresolvedPaths.join("、")}` : "";
          failure = `第 ${processed + 1} 条迁移失败（${result.receipt?.status ?? result.outcome}）${unresolved}`;
          break;
        }
      }
    } catch (error) {
      failure = `第 ${processed + 1} 条迁移发生冲突：${errorMessage(error)}`;
    } finally {
      for (const task of tasks) await this.index.refreshPath(task.path);
      await this.index.refreshPath(targetPath);
      await this.persistJournal();
      await this.refresh();
    }
    if (failure) throw new Error(`已完成 ${processed}/${tasks.length} 条。${failure}`);
    return receipts;
  }

  async updateKnowledge(path: string, status: string, projectPath?: string): Promise<TransactionReceipt> {
    this.requireWrites();
    if (!["待处理", "待沉淀", "待读", "已归档", "重复"].includes(status)) {
      throw new Error("不支持的知识处理状态。");
    }
    const before = await this.vaultPort.read(path);
    let after = setFrontmatterField(before, "triage_status", status);
    after = setFrontmatterField(after, "project", projectPath ? toWikiLink(projectPath) : "");
    const receipt = await this.transactions.execute({
      label: `Update knowledge: ${path}`,
      operations: [{ kind: "write", path, content: after, expectedRevision: contentRevision(before) }]
    });
    await this.afterReceipt(receipt, path);
    return receipt;
  }

  async saveLayout(sceneId: string, items: LayoutItem[]): Promise<void> {
    const registry = createBuiltinWidgetRegistry();
    const candidate: LayoutSchema = {
      version: 1,
      id: sceneId,
      name: this.plugin.settings.layouts.find((layout) => layout.id === sceneId)?.name ?? sceneName(sceneId),
      surface: "workbench",
      items: items.map((item) => ({ ...item, config: item.config ? { ...item.config } : undefined }))
    };
    const result = validateLayout(candidate, registry);
    if (!result.valid) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
    const index = this.plugin.settings.layouts.findIndex((layout) => layout.surface === "workbench" && layout.id === sceneId);
    if (index >= 0) this.plugin.settings.layouts[index] = result.layout;
    else this.plugin.settings.layouts.push(result.layout);
    this.plugin.settings.activeWorkbenchLayout = sceneId;
    await this.plugin.saveSettings();
  }

  async activateLayout(sceneId: string): Promise<void> {
    this.requireLayout(sceneId);
    this.plugin.settings.activeWorkbenchLayout = sceneId;
    await this.plugin.saveSettings();
  }

  async copyLayout(sceneId: string, name: string): Promise<string> {
    const source = this.requireLayout(sceneId);
    const id = `layout-${Date.now().toString(36)}`;
    this.plugin.settings.layouts.push({ ...structuredClone(source), id, name: name.trim() || `${source.name} 副本` });
    this.plugin.settings.activeWorkbenchLayout = id;
    await this.plugin.saveSettings();
    return id;
  }

  async renameLayout(sceneId: string, name: string): Promise<void> {
    const layout = this.requireLayout(sceneId);
    if (!name.trim()) throw new Error("布局名称不能为空。");
    layout.name = name.trim();
    await this.plugin.saveSettings();
  }

  async restoreLayout(sceneId: string): Promise<void> {
    const original = getDefaultLayouts().find((layout) => layout.id === sceneId);
    if (!original) throw new Error("自定义布局没有内置默认值，可复制其他布局后继续调整。");
    const index = this.plugin.settings.layouts.findIndex((layout) => layout.id === sceneId && layout.surface === "workbench");
    if (index >= 0) this.plugin.settings.layouts[index] = original;
    else this.plugin.settings.layouts.push(original);
    await this.plugin.saveSettings();
  }

  exportLayout(sceneId: string): string {
    return JSON.stringify(this.requireLayout(sceneId), null, 2);
  }

  async importLayout(payload: string): Promise<string> {
    let value: unknown;
    try { value = JSON.parse(payload); } catch { throw new Error("布局 JSON 无法解析。"); }
    const result = validateLayout(value, createBuiltinWidgetRegistry());
    if (!result.valid) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
    if (result.layout.surface !== "workbench") throw new Error("工作台只能导入 workbench 布局；侧栏布局请在设置页导入。");
    if (this.plugin.settings.layouts.some((layout) => layout.id === result.layout.id)) {
      throw new Error(`布局 ID 已存在：${result.layout.id}`);
    }
    this.plugin.settings.layouts.push(result.layout);
    this.plugin.settings.activeWorkbenchLayout = result.layout.id;
    await this.plugin.saveSettings();
    return result.layout.id;
  }

  async undoLastTransaction(): Promise<TransactionReceipt | undefined> {
    this.requireWrites();
    const receipt = await this.transactions.undo();
    await this.afterReceipt(receipt);
    return receipt;
  }

  async persistJournal(): Promise<void> {
    await this.plugin.saveSettings(this.journal.serialize());
  }

  private createIndex(): EntityIndex {
    const settings = this.plugin.settings;
    return new EntityIndex(this.vaultPort, {
      definitions: [
        { kind: "project", folder: settings.projectFolder, typeValues: ["project", "项目"] },
        { kind: "client", folder: settings.clientFolder, typeValues: ["client", "客户"], aliases: settings.clientAliases },
        { kind: "meeting", folder: settings.meetingFolder, typeValues: ["meeting", "会议", "会议纪要"] },
        { kind: "supplier", folder: settings.supplierFolder, typeValues: ["supplier", "供应商"] },
        { kind: "knowledge", folder: settings.knowledgeFolder, typeValues: ["knowledge", "note", "知识"], allowUntyped: true, acceptAllTypes: true }
      ]
    });
  }

  private makeIndexSignature(): string {
    const settings = this.plugin.settings;
    return JSON.stringify({
      projectFolder: settings.projectFolder,
      clientFolder: settings.clientFolder,
      meetingFolder: settings.meetingFolder,
      supplierFolder: settings.supplierFolder,
      knowledgeFolder: settings.knowledgeFolder,
      clientAliases: settings.clientAliases
    });
  }

  private summaries(kind: EntityKind): EntitySummary[] {
    return this.index.listEntities(kind).map((entity) => entitySummary(entity));
  }

  private buildContext(path?: string): ContextSnapshot {
    if (!path) return { title: "未选择笔记", relatedProjects: [], tasks: [], meetings: [] };
    const entity = this.index.getEntity(path);
    const title = entity?.name ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
    const relatedProjects = this.index
      .listEntities("project")
      .filter((project) => project.path === path || entityReferences(project, entity, path))
      .map(entitySummary);
    const tasks = this.index
      .listTasks()
      .filter((task) => task.path === path || relatedProjects.some((project) => task.path === project.path));
    const meetings = this.index
      .listEntities("meeting")
      .filter((meeting) => meeting.path === path || entityReferences(meeting, entity, path))
      .map(entitySummary);
    return {
      path,
      title,
      kind: entity?.kind,
      status: entity ? fieldString(entity.fields, ["status", "relationship_status", "triage_status"]) : undefined,
      relatedProjects,
      tasks,
      meetings
    };
  }

  private findTask(expected: TaskRecord): TaskRecord {
    const fresh = this.index.listTasks(expected.scope).find((task) => task.id === expected.id || (task.path === expected.path && task.line === expected.line));
    if (!fresh) throw new Error("任务已被外部修改或删除，请刷新后重试。");
    return fresh;
  }

  private requireLayout(id: string): LayoutSchema {
    const layout = this.plugin.settings.layouts.find((entry) => entry.id === id && entry.surface === "workbench");
    if (!layout) throw new Error(`布局不存在：${id}`);
    return layout;
  }

  private migrationTargetScope(path: string): "project" | "client" {
    const kind = this.index.getEntity(path)?.kind;
    if (kind === "project" || kind === "client") return kind;
    throw new Error("会议行动项只能迁移到已索引的项目或客户笔记。");
  }

  private folderForKind(kind: Exclude<EntityKind, "knowledge">): string {
    const key: Record<typeof kind, keyof Pick<QuietWorkbenchSettings, "projectFolder" | "clientFolder" | "meetingFolder" | "supplierFolder">> = {
      project: "projectFolder",
      client: "clientFolder",
      meeting: "meetingFolder",
      supplier: "supplierFolder"
    };
    return normalizeVaultPath(this.plugin.settings[key[kind]]);
  }

  private requireWrites(): void {
    if (!this.plugin.settings.writesEnabled) {
      throw new Error("当前为只读诊断模式。请先在 Quiet Workbench 设置中明确启用写入。");
    }
  }

  private async afterReceipt(receipt: DetailedTransactionReceipt, path?: string): Promise<void> {
    this.current = { ...this.current, lastReceipt: receipt };
    if (path) await this.index.refreshPath(path);
    await this.persistJournal();
    await this.refresh();
    if (receipt.status !== "committed") {
      const unresolved = receipt.unresolvedPaths.length ? ` 未恢复：${receipt.unresolvedPaths.join("、")}` : "";
      throw new Error(`操作未完成（${receipt.status}）。${receipt.messages.join(" ")}${unresolved}`);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}

export default class QuietWorkbenchPlugin extends Plugin {
  settings: QuietWorkbenchSettings = structuredClone(DEFAULT_SETTINGS);
  private controller?: PluginWorkbenchController;
  private refreshTimer?: number;
  private journalData?: PersistedPluginData["transactionJournal"];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.controller = new PluginWorkbenchController(this, this.journalData);

    this.registerView(WORKBENCH_VIEW_TYPE, (leaf) => new WorkbenchItemView(leaf, this.requireController()));
    this.registerView(CONTEXT_PANEL_VIEW_TYPE, (leaf) => new ContextPanelView(leaf, this.requireController()));
    this.addSettingTab(new QuietWorkbenchSettingTab(this.app, this));

    this.addRibbonIcon("layout-dashboard", "打开 Quiet Workbench", () => void this.activateWorkbench());
    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => void this.activateWorkbench() });
    this.addCommand({ id: "open-context-panel", name: "打开上下文侧栏", callback: () => void this.activateContextPanel() });
    this.addCommand({ id: "refresh-workbench", name: "刷新索引并运行诊断", callback: () => void this.refreshWorkbench() });
    this.addCommand({
      id: "undo-last-transaction",
      name: "撤销最近一次 Workbench 写入",
      callback: () => void this.requireController().undoLastTransaction().catch((error) => new Notice(errorMessage(error)))
    });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.syncActiveFile()));
    this.registerEvent(this.app.vault.on("create", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.scheduleRefresh(file)));
    this.register(() => {
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    });

    this.app.workspace.onLayoutReady(() => {
      void this.refreshWorkbench();
      void this.syncActiveFile();
    });
  }

  onunload(): void {
    if (this.controller) void this.controller.persistJournal();
  }

  async activateWorkbench(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateContextPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(CONTEXT_PANEL_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("无法创建右侧面板。");
    if (!existing) await leaf.setViewState({ type: CONTEXT_PANEL_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async refreshWorkbench(): Promise<void> {
    try {
      await this.requireController().refresh();
    } catch (error) {
      console.error("Quiet Workbench refresh failed", error);
      new Notice(`Quiet Workbench 刷新失败：${errorMessage(error)}`);
    }
  }

  async saveSettings(journal = this.journalData): Promise<void> {
    this.journalData = journal;
    await this.saveData({ ...this.settings, transactionJournal: journal });
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as PersistedPluginData | null;
    this.journalData = data?.transactionJournal;
    const layouts = data?.layouts?.length ? data.layouts : getDefaultLayouts();
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...data,
      templates: { ...DEFAULT_SETTINGS.templates, ...data?.templates },
      clientAliases: { ...DEFAULT_SETTINGS.clientAliases, ...data?.clientAliases },
      enabledPacks: { ...DEFAULT_SETTINGS.enabledPacks, ...data?.enabledPacks },
      layouts
    };
  }

  private async syncActiveFile(): Promise<void> {
    await this.requireController().setActivePath(this.app.workspace.getActiveFile()?.path);
  }

  private scheduleRefresh(file: TAbstractFile): void {
    if (!(file instanceof TFile || file instanceof TFolder)) return;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refreshWorkbench(), 350);
  }

  private requireController(): PluginWorkbenchController {
    if (!this.controller) throw new Error("Quiet Workbench 尚未初始化。");
    return this.controller;
  }
}

function entitySummary(entity: EntityRecord): EntitySummary {
  return {
    kind: entity.kind,
    name: entity.name,
    path: entity.path,
    status: entity.kind === "knowledge"
      ? fieldString(entity.fields, ["triage_status", "status"])
      : fieldString(entity.fields, ["status", "project_status", "relationship_status"]),
    related: fieldString(entity.fields, ["project", "projects", "client", "customer", "organization"]),
    detail: fieldString(entity.fields, ["next_action", "main_requirement", "topic", "profile_summary"]),
    due: fieldString(entity.fields, ["due", "target_date", "followup_date", "meeting_date"]),
    phase: fieldString(entity.fields, ["phase", "project_phase"]),
    updatedAt: entity.mtime
  };
}

function fieldString(fields: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (Array.isArray(value) && value.length) {
      const text = value.map(safeScalarString).filter(Boolean).join("、");
      if (text) return text;
    }
    const text = safeScalarString(value);
    if (text) return text;
  }
  return undefined;
}

function safeScalarString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return "";
}

function entityReferences(candidate: EntityRecord, active: EntityRecord | undefined, activePath: string): boolean {
  const haystack = JSON.stringify(candidate.fields).toLowerCase();
  const pathName = activePath.split("/").pop()?.replace(/\.md$/i, "").toLowerCase() ?? "";
  const activeName = active?.name.toLowerCase() ?? pathName;
  return Boolean(activeName && (haystack.includes(activeName) || haystack.includes(activePath.toLowerCase())));
}

function isClosedStatus(status?: string): boolean {
  return ["closed", "done", "completed", "archived", "已完成", "已关闭", "已归档"].includes((status ?? "").trim().toLowerCase());
}

function sanitizeTitle(value: string): string {
  const title = value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ");
  if (!title || title === "." || title === "..") throw new Error("名称不能为空。");
  return title;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function applyEntityContext(content: string, input: CreateEntityInput): string {
  let result = content;
  if (input.relatedClient) result = setFrontmatterField(result, "client", toWikiLink(input.relatedClient));
  if (input.relatedProject) result = setFrontmatterField(result, "project", toWikiLink(input.relatedProject));
  if (input.date) {
    result = setFrontmatterField(result, "meeting_date", input.date);
    result = result.replaceAll("{{date}}", input.date).replaceAll("{{ date }}", input.date);
  }
  return result;
}

function toWikiLink(path: string): string {
  const target = normalizeVaultPath(path).replace(/\.md$/iu, "");
  return `[[${target}]]`;
}

function setFrontmatterField(content: string, key: string, value: string): string {
  const normalized = content.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) throw new Error("目标模板或知识笔记缺少 YAML frontmatter。");
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new Error("YAML frontmatter 没有正确结束。");
  const header = normalized.slice(4, end);
  const encoded = JSON.stringify(value);
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:.*$`, "mu");
  const nextHeader = pattern.test(header) ? header.replace(pattern, `${key}: ${encoded}`) : `${header}\n${key}: ${encoded}`;
  return `---\n${nextHeader}\n---${normalized.slice(end + 4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sceneName(sceneId: string): string {
  return { today: "今日执行", projects: "项目管理", knowledge: "知识整理" }[sceneId] ?? sceneId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
