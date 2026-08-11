# Quiet Workbench

Quiet Workbench is a local-first Obsidian plugin for managing projects, tasks,
clients, suppliers, meetings, and knowledge without moving business data out of
Markdown files.

## Safety model

- The first launch is read-only.
- Business writes must be enabled explicitly in settings.
- Multi-file changes use preflight checks, receipts, and compensating restore.
- The plugin has no telemetry, accounts, network calls, or self-updater.

## Local installation

Run `pnpm install && pnpm verify`, then copy `main.js`, `manifest.json`, and
`styles.css` into `<vault>/.obsidian/plugins/quiet-workbench/`.

## 使用流程

1. 在 Obsidian 的「第三方插件」中启用 Quiet Workbench。
2. 先运行命令「刷新索引并运行诊断」；初始状态不会写入业务笔记。
3. 用 Ribbon 图标打开完整工作台，用命令「打开上下文侧栏」打开右侧面板。
4. 核对目录、模板和字段别名后，在插件设置中二次确认启用写入。
5. 原 `Workbench.md`、`Workbench Panel.md` 和 Homepage 配置不会自动删除或替换。

工作台包含今日执行、项目管理、知识整理三套默认布局。桌面端可拖动和缩放，
移动端使用排序、折叠和隐藏。布局撤销与业务事务撤销相互独立。

独立任务看板可通过 Ribbon 的任务图标或命令「打开任务看板」进入。看板支持按
日期或状态分栏、按三类来源筛选、搜索、完成、恢复、改期、优先级，以及会议草稿
迁移。右侧上下文面板同时显示全局未来 7 天（含逾期）待办和当前笔记相关任务。

会议行动项迁移完成后，来源会议任务会被勾选并写入迁移标记，目标项目或客户会
得到带稳定 block ID 的新任务。迁移后的目标任务可直接在任务看板中确认。

## Data compatibility

- Task scopes: `project`, `client`, and `meeting-draft`.
- Canonical client fields: `organization_type`, `business_domains`,
  `relationship_status`, and `followup_date`.
- Knowledge states: 待处理、待沉淀、待读、已归档、重复.
- Templater compatibility is deliberately limited to `tp.file.title` and
  `tp.date.now(...)`; arbitrary template JavaScript is never executed.

## GitHub and approval

GitHub is not required for local installation and local use does not need
Obsidian approval. A local Git repository is sufficient for private versioning.

For beta distribution, publish versioned GitHub Releases and optionally use
BRAT. For the official Community directory, the source must be reviewable on
GitHub and the repository root must contain `README.md`, `LICENSE`, and
`manifest.json`. The release tag must exactly match `manifest.version` (for
example `0.1.0`, not `v0.1.0`) and attach `main.js`, `manifest.json`, and
`styles.css`. Initial listing requires Obsidian's automated review. Later
versions use matching GitHub Releases and continue to receive security scans.

## Development

Use a separate test vault containing only fictitious data. Node.js 22 LTS and
pnpm are the supported development toolchain.
