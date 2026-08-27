import { App, Modal, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { validateLayout } from "./core/layout";
import { createBuiltinWidgetRegistry } from "./core/widget-registry";
import type { QuietWorkbenchSettings } from "./settings";
import type { LayoutItem, LayoutSchema } from "./core/types";

const SIDEBAR_COMPONENTS = [
  ["core.context", "当前笔记"],
  ["tasks.upcoming", "近期待办"],
  ["capture.memo", "速记"],
  ["tasks.context", "相关任务"],
  ["projects.context", "关联项目"],
  ["meetings.context", "相关会议"],
  ["core.quick-create", "快捷入口"]
] as const;

export interface QuietWorkbenchSettingsHost {
  app: App;
  settings: QuietWorkbenchSettings;
  saveSettings(): Promise<void>;
  refreshWorkbench(): Promise<void>;
}

class WriteConfirmationModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly resolve: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("qwb-confirm-modal");
    contentEl.createEl("h2", { text: "启用 Asterism 写入" });
    contentEl.createEl("p", {
      text: "启用后，插件可以按照已配置的目录和模板创建或修改 Markdown 文件。写入前仍会执行冲突检查，并记录可撤销的事务。"
    });
    const list = contentEl.createEl("ul");
    list.createEl("li", { text: "请先确认诊断页没有路径或模板错误。" });
    list.createEl("li", { text: "建议保持 Vault 同步或备份正常。" });
    list.createEl("li", { text: "插件不会批量改写历史笔记。" });
    const actions = contentEl.createDiv({ cls: "qwb-modal-actions" });
    const cancel = actions.createEl("button", { text: "保持只读" });
    const confirm = actions.createEl("button", { text: "我已了解，启用写入", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.finish(false));
    confirm.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(false);
  }

  private finish(value: boolean): void {
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

export class QuietWorkbenchSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: QuietWorkbenchSettingsHost) {
    super(app, host as never);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("qwb-settings");
    containerEl.createEl("p", {
      text: "所有业务数据仍保存在 Markdown 中。首次使用请先检查目录和模板，再明确启用写入。",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("运行模式")
      .setDesc(this.host.settings.writesEnabled ? "写入已启用。所有写入仍会执行预检查和记录回执。" : "只读诊断模式，不会修改业务笔记。")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.writesEnabled).onChange(async (value) => {
          if (value) {
            const confirmed = await new Promise<boolean>((resolve) => new WriteConfirmationModal(this.app, resolve).open());
            if (!confirmed) {
              toggle.setValue(false);
              return;
            }
          }
          this.host.settings.writesEnabled = value;
          await this.host.saveSettings();
          await this.host.refreshWorkbench();
          new Notice(value ? "Asterism 写入已启用" : "Asterism 已切换为只读模式");
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("重新运行诊断")
      .setDesc("检查业务目录、模板和当前字段兼容情况，不写入任何笔记。")
      .addButton((button) =>
        button.setButtonText("运行诊断").onClick(async () => {
          button.setDisabled(true);
          await this.host.refreshWorkbench();
          button.setDisabled(false);
          new Notice("诊断完成，请在 Asterism 工作台中查看结果");
        })
      );

    new Setting(containerEl).setName("业务目录").setHeading();
    this.addPathSetting(containerEl, "项目目录", "projectFolder");
    this.addPathSetting(containerEl, "客户目录", "clientFolder");
    this.addPathSetting(containerEl, "会议目录", "meetingFolder");
    this.addPathSetting(containerEl, "供应商目录", "supplierFolder");
    this.addPathSetting(containerEl, "知识目录", "knowledgeFolder");
    this.addPathSetting(containerEl, "正式知识目录", "formalKnowledgeFolder");

    new Setting(containerEl).setName("速记").setHeading();
    this.addFilePathSetting(containerEl, "速记文件", "memoPath", "快速输入会追加到此 Markdown 文件；不会修改任何模板。");

    new Setting(containerEl).setName("模板").setHeading();
    this.addTemplateSetting(containerEl, "项目模板", "project");
    this.addTemplateSetting(containerEl, "客户模板", "client");
    this.addTemplateSetting(containerEl, "会议模板", "meeting");
    this.addTemplateSetting(containerEl, "供应商模板", "supplier");
    new Setting(containerEl)
      .setName("知识模板（可选）")
      .setDesc("留空时使用插件内置安全模板；模板只读取，不会被插件修改，也不会执行 JavaScript。")
      .addText((text) => text.setValue(this.host.settings.knowledgeTemplate).onChange(async (value) => {
        this.host.settings.knowledgeTemplate = value.trim() ? normalizePath(value.trim()) : "";
        await this.host.saveSettings();
      }));

    new Setting(containerEl).setName("客户字段兼容").setHeading();
    containerEl.createEl("p", {
      text: "左侧为标准字段；输入用逗号分隔的历史字段名。读取时优先使用标准字段。",
      cls: "setting-item-description"
    });
    for (const canonical of ["organization_type", "business_domains", "relationship_status", "followup_date"]) {
      new Setting(containerEl)
        .setName(canonical)
        .addText((text) =>
          text
            .setPlaceholder("legacy_field, old_field")
            .setValue((this.host.settings.clientAliases[canonical] ?? []).join(", "))
            .onChange(async (value) => {
              this.host.settings.clientAliases[canonical] = value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);
              await this.host.saveSettings();
            })
        );
    }

    new Setting(containerEl).setName("功能包").setHeading();
    const packs: Record<string, string> = {
      projects: "项目管理",
      tasks: "任务管理",
      clients: "客户管理",
      meetings: "会议管理",
      suppliers: "供应商管理",
      knowledge: "知识整理"
    };
    for (const [id, label] of Object.entries(packs)) {
      new Setting(containerEl)
        .setName(label)
        .setDesc("关闭后隐藏对应组件；不会删除或修改已有笔记。")
        .addToggle((toggle) =>
          toggle.setValue(this.host.settings.enabledPacks[id] !== false).onChange(async (value) => {
            this.host.settings.enabledPacks[id] = value;
            await this.host.saveSettings();
            await this.host.refreshWorkbench();
          })
        );
    }

    new Setting(containerEl).setName("历史与撤销").setHeading();
    new Setting(containerEl)
      .setName("设备本地事务记录数")
      .setDesc("默认保存最近 50 次操作回执。布局撤销与业务撤销相互独立。")
      .addText((text) =>
        text.setValue(String(this.host.settings.transactionLimit)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            this.host.settings.transactionLimit = Math.max(10, Math.min(200, parsed));
            await this.host.saveSettings();
          }
        })
      );

    new Setting(containerEl).setName("侧栏布局").setHeading();
    const activeSidebar = this.host.settings.layouts.find(
      (layout) => layout.surface === "sidebar" && layout.id === this.host.settings.activeSidebarLayout
    );
    if (activeSidebar) {
      containerEl.createEl("p", { text: "常用组件可在这里排序、隐藏、折叠或移除；变更只影响侧栏布局，不会修改笔记。", cls: "setting-item-description" });
      activeSidebar.items.slice().sort((left, right) => left.y - right.y).forEach((item, position, rows) => {
        const label = SIDEBAR_COMPONENTS.find(([id]) => id === item.widgetId)?.[1] ?? item.widgetId;
        new Setting(containerEl)
          .setName(label)
          .setDesc(item.hidden ? "已隐藏" : item.collapsed ? "已折叠" : "正在显示")
          .addExtraButton((button) => button.setIcon("arrow-up").setTooltip("上移").setDisabled(position === 0).onClick(async () => this.moveSidebarItem(activeSidebar, rows, position, -1)))
          .addExtraButton((button) => button.setIcon("arrow-down").setTooltip("下移").setDisabled(position === rows.length - 1).onClick(async () => this.moveSidebarItem(activeSidebar, rows, position, 1)))
          .addToggle((toggle) => toggle.setTooltip("显示").setValue(!item.hidden).onChange(async (value) => { item.hidden = !value; await this.saveSidebarLayout(activeSidebar); this.display(); }))
          .addToggle((toggle) => toggle.setTooltip("折叠").setValue(Boolean(item.collapsed)).onChange(async (value) => { item.collapsed = value; await this.saveSidebarLayout(activeSidebar); this.display(); }))
          .addExtraButton((button) => button.setIcon("trash-2").setTooltip("移除").onClick(async () => { activeSidebar.items = activeSidebar.items.filter((entry) => entry !== item); await this.saveSidebarLayout(activeSidebar); this.display(); }));
      });
      let selectedSidebarWidget: string = SIDEBAR_COMPONENTS.find(([id]) => !activeSidebar.items.some((item) => item.widgetId === id))?.[0] ?? SIDEBAR_COMPONENTS[0][0];
      new Setting(containerEl)
        .setName("添加侧栏组件")
        .addDropdown((dropdown) => { for (const [id, label] of SIDEBAR_COMPONENTS) dropdown.addOption(id, label); dropdown.setValue(selectedSidebarWidget).onChange((value) => { selectedSidebarWidget = value; }); })
        .addButton((button) => button.setButtonText("添加").onClick(async () => {
          if (activeSidebar.items.some((item) => item.widgetId === selectedSidebarWidget)) { new Notice("该侧栏组件已经存在，可直接调整显示或顺序"); return; }
          const definition = createBuiltinWidgetRegistry().get(selectedSidebarWidget);
          if (!definition?.surfaces.includes("sidebar")) { new Notice("该组件不支持侧栏"); return; }
          activeSidebar.items.push({ widgetId: selectedSidebarWidget, x: 0, y: activeSidebar.items.length, width: 1, height: definition.defaultSize.height });
          await this.saveSidebarLayout(activeSidebar);
          this.display();
        }));
    }
    let sidebarJson = JSON.stringify(activeSidebar, null, 2);
    new Setting(containerEl)
      .setName("侧栏布局 JSON")
      .setDesc("可调整组件顺序、隐藏与折叠状态；应用前会验证版本、组件和单列约束。")
      .addTextArea((area) => area.setValue(sidebarJson).onChange((value) => { sidebarJson = value; }))
      .addButton((button) => button.setButtonText("复制").onClick(async () => {
        await navigator.clipboard.writeText(sidebarJson);
        new Notice("侧栏布局已复制");
      }))
      .addButton((button) => button.setButtonText("验证并应用").setCta().onClick(async () => {
        let parsed: unknown;
        try { parsed = JSON.parse(sidebarJson); } catch { new Notice("侧栏布局 JSON 无法解析"); return; }
        const result = validateLayout(parsed, createBuiltinWidgetRegistry());
        if (!result.valid) { new Notice(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；")); return; }
        if (result.layout.surface !== "sidebar") { new Notice("这里仅接受 sidebar 布局"); return; }
        const index = this.host.settings.layouts.findIndex((layout) => layout.id === result.layout.id);
        if (index >= 0) this.host.settings.layouts[index] = result.layout;
        else this.host.settings.layouts.push(result.layout);
        this.host.settings.activeSidebarLayout = result.layout.id;
        await this.host.saveSettings();
        await this.host.refreshWorkbench();
        new Notice("侧栏布局已应用");
      }));

    const privacy = containerEl.createDiv({ cls: "qwb-settings-note" });
    privacy.createEl("strong", { text: "本地优先" });
    privacy.createEl("p", {
      text: "Asterism 不联网、不收集遥测，也不会调用第三方插件的非公开接口。Dataview、Tasks、Templater 与 Full Calendar 仅作为可选增强。"
    });
  }

  private addPathSetting(container: HTMLElement, label: string, key: "projectFolder" | "clientFolder" | "meetingFolder" | "supplierFolder" | "knowledgeFolder" | "formalKnowledgeFolder"): void {
    new Setting(container)
      .setName(label)
      .setDesc("相对于 Vault 根目录；保存时会规范化路径。")
      .addText((text) =>
        text.setValue(this.host.settings[key]).onChange(async (value) => {
          this.host.settings[key] = normalizePath(value.trim());
          await this.host.saveSettings();
        })
      );
  }

  private addFilePathSetting(container: HTMLElement, label: string, key: "memoPath", description: string): void {
    new Setting(container)
      .setName(label)
      .setDesc(description)
      .addText((text) =>
        text.setValue(this.host.settings[key]).onChange(async (value) => {
          this.host.settings[key] = normalizePath(value.trim());
          await this.host.saveSettings();
        })
      );
  }

  private addTemplateSetting(container: HTMLElement, label: string, key: keyof QuietWorkbenchSettings["templates"]): void {
    new Setting(container)
      .setName(label)
      .setDesc("模板内可使用标题和日期占位符；不会执行任意 JavaScript。")
      .addText((text) =>
        text.setValue(this.host.settings.templates[key]).onChange(async (value) => {
          this.host.settings.templates[key] = normalizePath(value.trim());
          await this.host.saveSettings();
        })
      );
  }

  private async moveSidebarItem(layout: LayoutSchema, rows: LayoutItem[], position: number, offset: -1 | 1): Promise<void> {
    const target = position + offset;
    if (target < 0 || target >= rows.length) return;
    [rows[position], rows[target]] = [rows[target], rows[position]];
    rows.forEach((item, index) => { item.y = index; });
    layout.items = rows;
    await this.saveSidebarLayout(layout);
    this.display();
  }

  private async saveSidebarLayout(layout: LayoutSchema): Promise<void> {
    const result = validateLayout(layout, createBuiltinWidgetRegistry());
    if (!result.valid) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
    const index = this.host.settings.layouts.findIndex((entry) => entry.id === layout.id && entry.surface === "sidebar");
    if (index >= 0) this.host.settings.layouts[index] = result.layout;
    else this.host.settings.layouts.push(result.layout);
    await this.host.saveSettings();
    await this.host.refreshWorkbench();
  }
}
