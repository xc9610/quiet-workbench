import {
  addIcon,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";
import type { ActivityDay, ContextSurface, EntityKind, EntityRecord, LayoutItem, LayoutSchema, TaskRecord, TransactionReceipt } from "./core/types";
import { DiagnosticService, type DiagnosticVaultReader } from "./core/diagnostic";
import { createBuiltinWidgetRegistry } from "./core/widget-registry";
import { ensureActivityHeatmap, ensureContextSidebarLayouts, ensureScheduleOverview, ensureSingleWorkbenchLayout, ensureUnscheduledTaskList, getDefaultLayouts, upgradePersistedLayouts, validateLayout } from "./core/layout";
import { DEFAULT_SIDEBAR_PROFILES } from "./core/sidebar-context";
import {
  migrateLayoutToOrderedGrid,
  migrateLayoutsToOrderedGrid,
  normalizeOrderedItems,
  ORDERED_GRID_VERSION
} from "./core/ordered-grid";
import {
  EntityIndex,
  KnowledgePublicationPlanner,
  MeetingMigrationService,
  ObsidianVaultAdapter,
  ProjectReviewService,
  ProjectTaskService,
  FullCalendarAdapter,
  TasksApiAdapter,
  TemplateService,
  TransactionJournal,
  WriteTransactionExecutor,
  contentRevision,
  normalizeVaultPath,
  type DetailedTransactionReceipt,
  type FullCalendarPluginAccess,
  type KnowledgePublicationInput,
  type KnowledgePublicationPreview,
  type MeetingMigrationBatchResult,
  type TasksApiV1,
  type VaultPort
} from "./services";
import { isTasksApiV1 } from "./services/tasks-api-adapter";
import { DEFAULT_SETTINGS, type QuietWorkbenchSettings } from "./settings";
import { appendQuickMemoContent, normalizeQuickMemoEntry, recentQuickMemoEntries } from "./domain/memo";
import { renderNoteMarkdown } from "./domain/note";
import {
  buildProjectReviewAiPrompt,
  buildProjectReviewEvidence,
  serializeProjectReviewEvidence,
  type ProjectReviewInput
} from "./domain/project-review";
import { formatDate } from "./services/template-service";
import { enhanceProjectTimeline, renderProjectRelatedFiles } from "./services/project-note-enhancer";
import { QuietWorkbenchSettingTab } from "./settings-tab";
import type {
  AddProjectTaskInput,
  ContextSnapshot,
  CreateEntityInput,
  CreateNoteInput,
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
import {
  TASK_BOARD_VIEW_TYPE,
  TaskBoardItemView
} from "./views/TaskBoardItemView";
import {
  PROJECT_REVIEW_VIEW_TYPE,
  ProjectReviewItemView
} from "./views/ProjectReviewItemView";

interface PersistedPluginData extends Partial<QuietWorkbenchSettings> {
  settingsSchemaVersion?: number;
  transactionJournal?: ReturnType<TransactionJournal["serialize"]>;
}

const CURRENT_SETTINGS_SCHEMA_VERSION = 10;
const LEGACY_MEMO_PATHS = new Set([
  "40_管理_Management/01_工作_Work/Workbench速记.md",
  "40_管理_Management/01_工作_Work/Quiet Workbench 速记.md"
]);
const ASTERISM_ICON_ID = "asterism-mark";
const ASTERISM_ICON_SVG = `
  <g transform="scale(4.1666667)">
    <path d="M6.4 2.6 7.45 5.45 10.3 6.5 7.45 7.55 6.4 10.4 5.35 7.55 2.5 6.5 5.35 5.45Z" fill="currentColor" stroke="none" />
    <path d="M17.7 3.1 18.45 5.15 20.5 5.9 18.45 6.65 17.7 8.7 16.95 6.65 14.9 5.9 16.95 5.15Z" fill="currentColor" stroke="none" />
    <path d="M15.15 12.2 16.45 15.65 19.9 16.95 16.45 18.25 15.15 21.7 13.85 18.25 10.4 16.95 13.85 15.65Z" fill="currentColor" stroke="none" />
    <path d="M8.35 8.45 12.65 13.35M16.95 8.55 15.95 12.65" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" opacity="0.72" />
  </g>
`;

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
  private readonly fullCalendar: FullCalendarAdapter;
  private readonly projectReviews: ProjectReviewService;
  private readonly meetingMigrations: MeetingMigrationService;
  private readonly knowledgePublications: KnowledgePublicationPlanner;
  private readonly templates = new TemplateService();
  private readonly diagnostics: DiagnosticService;
  private index: EntityIndex;
  private indexSignature: string;
  private current: WorkbenchSnapshot = structuredClone(EMPTY_SNAPSHOT);
  private disposed = false;

  constructor(private readonly plugin: QuietWorkbenchPlugin, journalData?: PersistedPluginData["transactionJournal"]) {
    this.vaultPort = new ObsidianVaultAdapter(plugin.app.vault, plugin.app.fileManager);
    this.journal = new TransactionJournal(plugin.settings.transactionLimit);
    if (journalData) {
      try {
        this.journal.hydrate(journalData);
      } catch (error) {
        console.warn("Asterism: ignored invalid transaction journal", error);
      }
    }
    this.transactions = new WriteTransactionExecutor(this.vaultPort, this.journal, {
      isPathProtected: (path) => this.isConfiguredTemplatePath(path)
    });
    this.tasks = new ProjectTaskService(
      this.vaultPort,
      this.transactions,
      new TasksApiAdapter(() => resolveTasksApi(plugin))
    );
    this.fullCalendar = new FullCalendarAdapter({
      resolvePlugin: () => resolveFullCalendarPlugin(plugin),
      getToken: () => plugin.settings.fullCalendarAccessToken,
      saveToken: async (token) => {
        plugin.settings.fullCalendarAccessToken = token;
        await plugin.saveSettings();
      },
      executeOpenCommand: () => executeFullCalendarOpenCommand(plugin)
    });
    this.projectReviews = new ProjectReviewService(this.vaultPort, this.transactions);
    this.meetingMigrations = new MeetingMigrationService(this.vaultPort, this.transactions);
    this.knowledgePublications = new KnowledgePublicationPlanner(this.vaultPort);
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
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const nextSignature = this.makeIndexSignature();
    if (nextSignature !== this.indexSignature) {
      this.index = this.createIndex();
      this.indexSignature = nextSignature;
    }
    const calendarRange = scheduleReadRange();
    const [update, report, memo, activity, calendar] = await Promise.all([
      this.index.scan(),
      this.diagnostics.run(this.plugin.settings),
      this.readQuickMemo(),
      this.readActivity(),
      this.fullCalendar.snapshot(calendarRange.start, calendarRange.end)
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
    if (memo.error) {
      diagnostics.push({
        id: "memo.path",
        label: "速记不可用",
        detail: memo.error,
        status: "warning"
      });
    }
    if (calendar.state === "error") {
      diagnostics.push({
        id: "full-calendar.api",
        label: "日程同步暂不可用",
        detail: calendar.error || "Full Calendar 公共 API 返回错误。",
        status: "warning"
      });
    }
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
      activity,
      calendar,
      transactionHistory: this.journal.list(),
      memo,
      context: this.buildContext(this.current.context.path, this.current.context.surface)
    };
    this.emit();
  }

  async openTaskBoard(): Promise<void> {
    await this.plugin.activateTaskBoard();
  }

  async openProjectReview(): Promise<void> {
    await this.plugin.activateProjectReview();
  }

  async openCalendar(): Promise<void> {
    await this.fullCalendar.openCalendar();
  }

  async openGlobalSearch(): Promise<void> {
    const commands = (this.plugin.app as typeof this.plugin.app & {
      commands?: { executeCommandById(id: string): boolean };
    }).commands;
    const opened = commands?.executeCommandById("omnisearch:show-modal")
      || commands?.executeCommandById("global-search:open");
    if (!opened) throw new Error("Omnisearch 与 Obsidian 全局搜索当前都不可用。");
  }

  async authorizeCalendar(): Promise<void> {
    await this.fullCalendar.authorize();
    await this.refresh();
  }

  async openWorkbench(): Promise<void> {
    await this.plugin.activateWorkbench();
  }

  async openContextPanel(): Promise<void> {
    await this.plugin.activateContextPanel();
  }

  async createBlankNote(): Promise<void> {
    await this.plugin.activateWorkbench();
    const view = this.plugin.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0]?.view;
    if (view instanceof WorkbenchItemView) view.openNoteForm();
  }

  async createNote(input: CreateNoteInput): Promise<TransactionReceipt> {
    this.requireWrites();
    const { path, content } = await this.previewNote(input);
    const receipt = await this.transactions.execute({
      label: `Create note: ${sanitizeTitle(input.title)}`,
      operations: [{ kind: "create", path, content }]
    });
    await this.afterReceipt(receipt, path);
    if (receipt.status === "committed" && input.openAfterCreate !== false) await this.openPath(path);
    return receipt;
  }

  async previewNote(input: CreateNoteInput): Promise<{ path: string; content: string }> {
    const title = sanitizeTitle(input.title);
    const folder = input.folder?.trim() ? normalizeVaultPath(input.folder.trim()) : "";
    const path = normalizeVaultPath(folder ? `${folder}/${title}.md` : `${title}.md`);
    const content = renderNoteMarkdown({
      title,
      body: input.body,
      relatedClient: input.relatedClient ? normalizeVaultPath(input.relatedClient) : undefined,
      relatedProject: input.relatedProject ? normalizeVaultPath(input.relatedProject) : undefined
    }, formatDate(new Date(), "YYYY-MM-DD"));
    return { path, content };
  }

  async setActivePath(path?: string, surface: ContextSurface = "note"): Promise<void> {
    this.current = { ...this.current, context: this.buildContext(path, surface) };
    this.emit();
  }

  async openPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
    const reviewing = this.plugin.app.workspace.getActiveViewOfType(ProjectReviewItemView);
    await this.plugin.app.workspace.getLeaf(reviewing ? "tab" : false).openFile(file);
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

  tasksIntegrationAvailable(): boolean {
    return this.tasks.isTasksIntegrationAvailable();
  }

  async addProjectTaskWithTasks(projectPath: string): Promise<"committed" | "cancelled" | "unavailable"> {
    this.requireWrites();
    const result = await this.tasks.addTaskWithTasks(projectPath);
    if (result.status !== "committed") return result.status;
    await this.afterReceipt(result.receipt, projectPath);
    return "committed";
  }

  async editTaskWithTasks(task: TaskRecord): Promise<"committed" | "cancelled" | "unavailable"> {
    this.requireWrites();
    const result = await this.tasks.editTaskWithTasks(task);
    if (result.status !== "committed") return result.status;
    await this.afterReceipt(result.receipt, task.path);
    return "committed";
  }

  async scheduleTaskInCalendar(task: TaskRecord, date: string): Promise<void> {
    this.requireWrites();
    await this.fullCalendar.scheduleTask(task, date);
    await this.refresh();
  }

  async updateTask(task: TaskRecord, patch: { completed?: boolean; due?: string | null; scheduled?: string | null; priority?: TaskRecord["priority"] }): Promise<TransactionReceipt> {
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

  async migrateMeetingTasks(tasks: TaskRecord[], targetPath: string) {
    this.requireWrites();
    const targetScope = this.migrationTargetScope(targetPath);
    const result = await this.meetingMigrations.migrateBatch({
      items: tasks.map((sourceTask) => ({ sourceTask, targetPath, targetScope })),
      stopOnFailure: true
    });
    await this.refreshMeetingBatchPaths(result);
    return result;
  }

  async retryMeetingMigration(batch: MeetingMigrationBatchResult) {
    this.requireWrites();
    const result = await this.meetingMigrations.retryBatch(batch, { stopOnFailure: true });
    await this.refreshMeetingBatchPaths(result);
    return result;
  }

  async updateKnowledge(path: string, status: string, projectPath?: string): Promise<TransactionReceipt> {
    this.requireWrites();
    if (!["待处理", "待沉淀", "待读", "已归档", "重复"].includes(status)) {
      throw new Error("不支持的知识处理状态。");
    }
    const before = await this.vaultPort.read(path);
    let after = setFrontmatterField(before, "triage_status", status);
    if (projectPath !== undefined) after = setFrontmatterField(after, "project", projectPath ? toWikiLink(projectPath) : "");
    const receipt = await this.transactions.execute({
      label: `Update knowledge: ${path}`,
      operations: [{ kind: "write", path, content: after, expectedRevision: contentRevision(before) }]
    });
    await this.afterReceipt(receipt, path);
    return receipt;
  }

  async previewKnowledgePublication(input: KnowledgePublicationInput): Promise<KnowledgePublicationPreview> {
    return this.knowledgePublications.preview(input);
  }

  async publishKnowledge(preview: KnowledgePublicationPreview): Promise<TransactionReceipt> {
    this.requireWrites();
    const receipt = await this.transactions.execute(preview.plan);
    await this.afterReceipt(receipt, preview.sourcePath);
    return receipt;
  }

  async appendQuickMemo(text: string): Promise<TransactionReceipt> {
    this.requireWrites();
    const configuredPath = this.plugin.settings.memoPath.trim();
    if (!configuredPath) throw new Error("请先在 Asterism 设置中配置速记文件。");
    const path = normalizeVaultPath(configuredPath);
    const entry = normalizeQuickMemoEntry(text);
    const exists = await this.vaultPort.exists(path);
    const before = exists ? await this.vaultPort.read(path) : "";
    const content = appendQuickMemoContent(before, entry);
    const receipt = await this.transactions.execute({
      label: "Append quick memo",
      operations: [exists
        ? { kind: "write", path, content, expectedRevision: contentRevision(before) }
        : { kind: "create", path, content }]
    });
    await this.afterReceipt(receipt);
    return receipt;
  }

  async saveProjectReview(input: ProjectReviewInput): Promise<TransactionReceipt> {
    this.requireWrites();
    const receipt = await this.projectReviews.save(input);
    await this.afterReceipt(receipt, input.projectPath);
    return receipt;
  }

  async openProjectReviewInYolo(projectPath: string): Promise<void> {
    const project = this.current.projects.find((entry) => entry.path === projectPath);
    if (!project) throw new Error("项目不在当前索引中，请先刷新后重试。");
    const today = formatDate(new Date(), "YYYY-MM-DD");
    const evidence = buildProjectReviewEvidence(
      project,
      this.current.tasks,
      this.current.meetings,
      today,
      Date.now(),
      this.current.knowledge
    );
    const prompt = `${buildProjectReviewAiPrompt(evidence, today)}\n\n${serializeProjectReviewEvidence(evidence, today)}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
    } catch {
      throw new Error("无法复制审阅说明，请检查 Obsidian 的剪贴板权限后重试。");
    }
    await this.openYolo(project.path);
  }

  async openYolo(path?: string): Promise<void> {
    if (path) {
      const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
      const leaf = this.plugin.app.workspace.getLeaf("tab");
      await leaf.openFile(file);
      await this.plugin.app.workspace.revealLeaf(leaf);
    }
    const commands = (this.plugin.app as typeof this.plugin.app & {
      commands?: { executeCommandById(id: string): boolean };
    }).commands;
    const commandId = path ? "yolo:new-chat-current-view" : "yolo:open-new-chat";
    const opened = commands?.executeCommandById(commandId)
      || (path ? commands?.executeCommandById("yolo:open-new-chat") : false);
    if (!opened) {
      throw new Error("YOLO 未安装、未启用，或没有提供“打开新对话”命令。");
    }
  }

  async saveLayout(sceneId: string, items: LayoutItem[]): Promise<void> {
    const registry = createBuiltinWidgetRegistry();
    const candidate: LayoutSchema = {
      version: 1,
      id: sceneId,
      name: this.plugin.settings.layouts.find((layout) => layout.id === sceneId)?.name ?? sceneName(sceneId),
      surface: "workbench",
      items: normalizeOrderedItems(items)
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
    const migrated = migrateLayoutToOrderedGrid(original);
    if (index >= 0) this.plugin.settings.layouts[index] = migrated;
    else this.plugin.settings.layouts.push(migrated);
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
    this.plugin.settings.layouts.push(migrateLayoutToOrderedGrid(result.layout));
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

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private createIndex(): EntityIndex {
    const settings = this.plugin.settings;
    return new EntityIndex(this.vaultPort, {
      definitions: [
        { kind: "project", folder: settings.projectFolder, typeValues: ["project", "项目"] },
        { kind: "client", folder: settings.clientFolder, typeValues: ["client", "客户"], aliases: settings.clientAliases },
        { kind: "meeting", folder: settings.meetingFolder, typeValues: ["meeting", "会议", "会议纪要"] },
        { kind: "supplier", folder: settings.supplierFolder, typeValues: ["supplier", "供应商"] },
        { kind: "knowledge", folder: settings.solutionAssetsFolder, typeValues: ["项目文件", "方案", "方案资产", "note"], allowUntyped: true, acceptAllTypes: true },
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
      solutionAssetsFolder: settings.solutionAssetsFolder,
      knowledgeFolder: settings.knowledgeFolder,
      clientAliases: settings.clientAliases
    });
  }

  private summaries(kind: EntityKind): EntitySummary[] {
    return this.index.listEntities(kind).map((entity) => entitySummary(entity));
  }

  private buildContext(path?: string, surface: ContextSurface = "note"): ContextSnapshot {
    if (!path) {
      const title = surface === "workbench" ? "工作台" : surface === "task-board" ? "任务看板" : "未选择笔记";
      return { surface, title, relatedProjects: [], tasks: [], meetings: [] };
    }
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
      surface,
      path,
      title,
      kind: entity?.kind,
      status: entity ? fieldString(entity.fields, ["status", "relationship_status", "triage_status"]) : undefined,
      relatedProjects,
      tasks,
      meetings
    };
  }

  private async readActivity(): Promise<ActivityDay[]> {
    const counts = new Map<string, number>();
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 370).getTime();
    for (const file of await this.vaultPort.listMarkdownFiles("")) {
      if (file.mtime < cutoff || file.path.split("/").some((segment) => segment.startsWith("."))) continue;
      const date = localDateKey(file.mtime);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));
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

  private async refreshMeetingBatchPaths(result: MeetingMigrationBatchResult): Promise<void> {
    for (const path of new Set(result.items.flatMap((item) => [item.sourcePath, item.targetPath]))) {
      await this.index.refreshPath(path);
    }
    await this.persistJournal();
    await this.refresh();
  }

  private isConfiguredTemplatePath(path: string): boolean {
    const normalized = comparableVaultPath(path);
    return [...Object.values(this.plugin.settings.templates), this.plugin.settings.knowledgeTemplate].some((templatePath) => {
      if (!templatePath.trim()) return false;
      try {
        return comparableVaultPath(templatePath) === normalized;
      } catch {
        return false;
      }
    });
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
    if (this.disposed) throw new Error("Asterism 已重载，请关闭当前旧页面后重新打开。");
    if (!this.plugin.settings.writesEnabled) {
      throw new Error("当前为只读诊断模式。请先在 Asterism 设置中明确启用写入。");
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

  private async readQuickMemo(): Promise<WorkbenchSnapshot["memo"]> {
    const configuredPath = this.plugin.settings.memoPath.trim();
    if (!configuredPath) return { path: "", exists: false, recent: [], error: "尚未配置速记文件路径。" };
    try {
      const path = normalizeVaultPath(configuredPath);
      if (!(await this.vaultPort.exists(path))) return { path, exists: false, recent: [] };
      const content = await this.vaultPort.read(path);
      return { path, exists: true, recent: recentQuickMemoEntries(content) };
    } catch (error) {
      return { path: configuredPath, exists: false, recent: [], error: `无法读取速记文件：${errorMessage(error)}` };
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
  private startupRefreshTimer?: number;
  private journalData?: PersistedPluginData["transactionJournal"];
  private lastPrimaryContext: { path?: string; surface: ContextSurface } = { surface: "note" };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyAppearanceMode();
    addIcon(ASTERISM_ICON_ID, ASTERISM_ICON_SVG);
    this.controller = new PluginWorkbenchController(this, this.journalData);

    this.registerView(WORKBENCH_VIEW_TYPE, (leaf) => new WorkbenchItemView(leaf, this.requireController()));
    this.registerView(TASK_BOARD_VIEW_TYPE, (leaf) => new TaskBoardItemView(leaf, this.requireController()));
    this.registerView(PROJECT_REVIEW_VIEW_TYPE, (leaf) => new ProjectReviewItemView(leaf, this.requireController()));
    this.registerView(CONTEXT_PANEL_VIEW_TYPE, (leaf) => new ContextPanelView(leaf, this.requireController()));
    this.registerMarkdownPostProcessor((el, context) => enhanceProjectTimeline(el, context));
    this.registerMarkdownCodeBlockProcessor("asterism-related-files", (source, el, context) => {
      renderProjectRelatedFiles(this.app, source, el, context);
    });
    this.addSettingTab(new QuietWorkbenchSettingTab(this.app, this));

    this.addRibbonIcon(ASTERISM_ICON_ID, "打开 Asterism 工作台", () => void this.activateWorkbench());
    this.addRibbonIcon("list-todo", "打开任务看板", () => void this.activateTaskBoard());
    this.addRibbonIcon("clipboard-check", "打开项目审阅", () => void this.activateProjectReview());
    this.addCommand({ id: "open-workbench", name: "打开工作台", callback: () => void this.activateWorkbench() });
    this.addCommand({ id: "open-task-board", name: "打开任务看板", callback: () => void this.activateTaskBoard() });
    this.addCommand({ id: "open-project-review", name: "打开项目审阅", callback: () => void this.activateProjectReview() });
    this.addCommand({
      id: "open-calendar",
      name: "打开完整日程",
      callback: () => void this.requireController().openCalendar().catch((error) => new Notice(errorMessage(error)))
    });
    this.addCommand({ id: "open-context-panel", name: "打开上下文侧栏", callback: () => void this.activateContextPanel() });
    this.addCommand({
      id: "create-blank-note",
      name: "新建笔记",
      callback: () => void this.requireController().createBlankNote().catch((error) => new Notice(errorMessage(error)))
    });
    this.addCommand({ id: "refresh-workbench", name: "刷新索引并运行诊断", callback: () => void this.refreshWorkbench() });
    this.addCommand({
      id: "undo-last-transaction",
      name: "撤销最近一次业务写入",
      callback: () => void this.requireController().undoLastTransaction().catch((error) => new Notice(errorMessage(error)))
    });
    this.registerObsidianProtocolHandler("asterism", () => void this.activateWorkbench());
    this.registerObsidianProtocolHandler("asterism-task-board", () => void this.activateTaskBoard());
    this.registerObsidianProtocolHandler("asterism-project-review", () => void this.activateProjectReview());

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.syncActiveFile()));
    this.registerEvent(this.app.vault.on("create", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.scheduleRefresh(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.scheduleRefresh(file)));
    this.register(() => {
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
      if (this.startupRefreshTimer !== undefined) window.clearTimeout(this.startupRefreshTimer);
    });

    this.app.workspace.onLayoutReady(() => {
      void this.rebindStaleViews()
        .then(() => Promise.all([
          this.refreshWorkbench(),
          this.syncActiveFile()
        ]))
        .then(() => this.settings.openWorkbenchOnStartup ? this.activateWorkbench() : undefined)
        .catch((error) => console.error("Asterism startup failed", error));
      this.startupRefreshTimer = window.setTimeout(() => void this.refreshWorkbench(), 800);
    });
  }

  onunload(): void {
    document.body.classList.remove("qwb-clear-mode", "qwb-journal-mode");
    if (this.controller) {
      this.controller.dispose();
      void this.controller.persistJournal();
    }
  }

  async activateWorkbench(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateTaskBoard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(TASK_BOARD_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: TASK_BOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateProjectReview(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PROJECT_REVIEW_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: PROJECT_REVIEW_VIEW_TYPE, active: true });
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
      console.error("Asterism refresh failed", error);
      new Notice(`Asterism 刷新失败：${errorMessage(error)}`);
    }
  }

  async saveSettings(journal = this.journalData): Promise<void> {
    this.journalData = journal;
    this.applyAppearanceMode();
    await this.saveData({
      ...this.settings,
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      transactionJournal: journal
    });
  }

  private applyAppearanceMode(): void {
    document.body.classList.remove("qwb-journal-mode");
    document.body.classList.add("qwb-clear-mode");
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as PersistedPluginData | null;
    this.journalData = data?.transactionJournal;
    const positionedLayouts = ensureUnscheduledTaskList(ensureScheduleOverview(ensureActivityHeatmap(ensureContextSidebarLayouts(ensureSingleWorkbenchLayout(
      upgradePersistedLayouts(data?.layouts?.length ? data.layouts : getDefaultLayouts()),
      data?.activeWorkbenchLayout
    )))));
    const needsOrderedGridMigration = data?.orderedGridVersion !== ORDERED_GRID_VERSION;
    const layouts = migrateLayoutsToOrderedGrid(positionedLayouts, needsOrderedGridMigration);
    const legacyPositionedLayouts = needsOrderedGridMigration && data?.layouts?.length
      ? structuredClone(positionedLayouts)
      : structuredClone(data?.legacyPositionedLayouts ?? []);
    const memoPath = !data?.memoPath || LEGACY_MEMO_PATHS.has(data.memoPath)
      ? DEFAULT_SETTINGS.memoPath
      : data.memoPath;
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...data,
      appearanceMode: "clear",
      templates: normalizeTemplatePaths({ ...DEFAULT_SETTINGS.templates, ...data?.templates }),
      clientAliases: { ...DEFAULT_SETTINGS.clientAliases, ...data?.clientAliases },
      enabledPacks: { ...DEFAULT_SETTINGS.enabledPacks, ...data?.enabledPacks },
      hero: {
        ...DEFAULT_SETTINGS.hero,
        ...data?.hero,
        customCopies: data?.hero?.customCopies ?? DEFAULT_SETTINGS.hero.customCopies
      },
      sidebarProfiles: { ...DEFAULT_SIDEBAR_PROFILES, ...data?.sidebarProfiles },
      memoPath,
      activeWorkbenchLayout: "workbench",
      layouts,
      orderedGridVersion: ORDERED_GRID_VERSION,
      legacyPositionedLayouts
    };
    if (data && (data.settingsSchemaVersion !== CURRENT_SETTINGS_SCHEMA_VERSION || needsOrderedGridMigration)) {
      await this.saveData({
        ...this.settings,
        settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
        transactionJournal: this.journalData
      });
    }
  }

  private async syncActiveFile(): Promise<void> {
    const viewType = this.app.workspace.activeLeaf?.view.getViewType();
    if (viewType === CONTEXT_PANEL_VIEW_TYPE) {
      await this.requireController().setActivePath(this.lastPrimaryContext.path, this.lastPrimaryContext.surface);
      return;
    }
    if (viewType === WORKBENCH_VIEW_TYPE) {
      this.lastPrimaryContext = { surface: "workbench" };
      await this.requireController().setActivePath(undefined, this.lastPrimaryContext.surface);
      return;
    }
    if (viewType === TASK_BOARD_VIEW_TYPE) {
      this.lastPrimaryContext = { surface: "task-board" };
      await this.requireController().setActivePath(undefined, this.lastPrimaryContext.surface);
      return;
    }
    if (viewType === PROJECT_REVIEW_VIEW_TYPE) {
      this.lastPrimaryContext = { surface: "workbench" };
      await this.requireController().setActivePath(undefined, this.lastPrimaryContext.surface);
      return;
    }
    this.lastPrimaryContext = { path: this.app.workspace.getActiveFile()?.path, surface: "note" };
    await this.requireController().setActivePath(this.lastPrimaryContext.path, this.lastPrimaryContext.surface);
  }

  private scheduleRefresh(file: TAbstractFile): void {
    if (!(file instanceof TFile || file instanceof TFolder)) return;
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refreshWorkbench(), 350);
  }

  private async rebindStaleViews(): Promise<void> {
    const controller = this.requireController();
    const entries = [
      {
        type: WORKBENCH_VIEW_TYPE,
        current: (view: unknown) => view instanceof WorkbenchItemView && view.usesController(controller)
      },
      {
        type: TASK_BOARD_VIEW_TYPE,
        current: (view: unknown) => view instanceof TaskBoardItemView && view.usesController(controller)
      },
      {
        type: PROJECT_REVIEW_VIEW_TYPE,
        current: (view: unknown) => view instanceof ProjectReviewItemView && view.usesController(controller)
      },
      {
        type: CONTEXT_PANEL_VIEW_TYPE,
        current: (view: unknown) => view instanceof ContextPanelView && view.usesController(controller)
      }
    ];
    for (const entry of entries) {
      for (const leaf of this.app.workspace.getLeavesOfType(entry.type)) {
        if (entry.current(leaf.view)) continue;
        const state = leaf.getViewState();
        await leaf.setViewState({ type: "empty", active: false });
        await leaf.setViewState({ ...state, type: entry.type });
      }
    }
  }

  private requireController(): PluginWorkbenchController {
    if (!this.controller) throw new Error("Asterism 尚未初始化。");
    return this.controller;
  }
}

function entitySummary(entity: EntityRecord): EntitySummary {
  return {
    kind: entity.kind,
    name: entity.name,
    path: entity.path,
    aliases: entity.aliases,
    status: entity.kind === "knowledge"
      ? fieldString(entity.fields, ["triage_status", "status"])
      : fieldString(entity.fields, ["status", "project_status", "relationship_status"]),
    related: fieldString(entity.fields, ["project", "projects", "client", "customer", "organization"]),
    detail: fieldString(entity.fields, ["next_action", "main_requirement", "topic", "profile_summary"]),
    due: fieldString(entity.fields, ["due", "target_date", "followup_date", "meeting_date"]),
    startTime: fieldString(entity.fields, ["startTime", "start_time"]),
    endTime: fieldString(entity.fields, ["endTime", "end_time"]),
    phase: fieldString(entity.fields, ["phase", "project_phase"]),
    projectType: fieldString(entity.fields, ["project_type"]),
    client: fieldString(entity.fields, ["client", "customer", "organization"]),
    project: fieldString(entity.fields, ["project", "projects"]),
    organizationType: fieldString(entity.fields, ["organization_type", "company_type"]),
    businessDomains: fieldString(entity.fields, ["business_domains", "business_type"]),
    relationshipStatus: fieldString(entity.fields, ["relationship_status", "stage", "status"]),
    followupDate: fieldString(entity.fields, ["followup_date", "next_followup"]),
    owner: fieldString(entity.fields, ["owner", "project_owner"]),
    businessType: fieldString(entity.fields, ["business_type", "business_domain"]),
    nextAction: fieldString(entity.fields, ["next_action"]),
    waitingOn: fieldString(entity.fields, ["waiting_on", "waiting_for", "waiting_review"]),
    reviewStatus: fieldString(entity.fields, ["review_status"]),
    reviewDue: fieldString(entity.fields, ["review_due"]),
    reviewNote: fieldString(entity.fields, ["review_note"]),
    reviewTrigger: fieldString(entity.fields, ["review_trigger"]),
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
  return ["closed", "done", "completed", "archived", "归档", "停止", "完成", "已完成", "已关闭", "已归档"].includes((status ?? "").trim().toLowerCase());
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

function localDateKey(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function applyEntityContext(content: string, input: CreateEntityInput): string {
  let result = content;
  if (input.relatedClient) result = setFrontmatterField(result, "client", toWikiLink(input.relatedClient));
  if (input.relatedProject) result = setFrontmatterField(result, "project", toWikiLink(input.relatedProject));
  if (input.date) {
    result = setFrontmatterField(result, "meeting_date", input.date);
    result = result.replaceAll("{{date}}", input.date).replaceAll("{{ date }}", input.date);
  }
  if (input.startTime) result = setFrontmatterField(result, "startTime", input.startTime);
  if (input.endTime) result = setFrontmatterField(result, "endTime", input.endTime);
  if (input.startTime || input.endTime) result = setFrontmatterField(result, "allDay", "false", false);
  return result;
}

function toWikiLink(path: string): string {
  const target = normalizeVaultPath(path).replace(/\.md$/iu, "");
  return `[[${target}]]`;
}

function setFrontmatterField(content: string, key: string, value: string, encode = true): string {
  const normalized = content.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) throw new Error("目标模板或知识笔记缺少 YAML frontmatter。");
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new Error("YAML frontmatter 没有正确结束。");
  const header = normalized.slice(4, end);
  const encoded = encode ? JSON.stringify(value) : value;
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:.*$`, "mu");
  const nextHeader = pattern.test(header) ? header.replace(pattern, `${key}: ${encoded}`) : `${header}\n${key}: ${encoded}`;
  return `---\n${nextHeader}\n---${normalized.slice(end + 4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sceneName(sceneId: string): string {
  return { workbench: "工作台", today: "今日执行", projects: "项目管理", knowledge: "知识整理" }[sceneId] ?? sceneId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PluginRegistryAccess {
  plugins?: { getPlugin(id: string): unknown };
  commands?: { executeCommandById(id: string): boolean };
}

function resolveTasksApi(plugin: QuietWorkbenchPlugin): TasksApiV1 | undefined {
  const registry = (plugin.app as unknown as PluginRegistryAccess).plugins;
  const tasksPlugin = registry?.getPlugin("obsidian-tasks-plugin") as { apiV1?: unknown } | undefined;
  return isTasksApiV1(tasksPlugin?.apiV1) ? tasksPlugin.apiV1 : undefined;
}

function resolveFullCalendarPlugin(plugin: QuietWorkbenchPlugin): FullCalendarPluginAccess | undefined {
  const registry = (plugin.app as unknown as PluginRegistryAccess).plugins;
  return (registry?.getPlugin("full-calendar-remastered") ?? registry?.getPlugin("full-calendar")) as FullCalendarPluginAccess | undefined;
}

function executeFullCalendarOpenCommand(plugin: QuietWorkbenchPlugin): boolean {
  const commands = (plugin.app as unknown as PluginRegistryAccess).commands;
  return Boolean(
    commands?.executeCommandById("full-calendar-remastered:full-calendar-open")
    || commands?.executeCommandById("full-calendar:full-calendar-open")
  );
}

function scheduleReadRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 13, 0, 23, 59, 59, 999);
  return { start, end };
}

function comparableVaultPath(path: string): string {
  return normalizeVaultPath(normalizePath(path)).normalize("NFC").toLowerCase();
}

function normalizeTemplatePaths(
  templates: QuietWorkbenchSettings["templates"]
): QuietWorkbenchSettings["templates"] {
  return Object.fromEntries(
    Object.entries(templates).map(([kind, path]) => [kind, normalizePath(path.trim())])
  ) as QuietWorkbenchSettings["templates"];
}
