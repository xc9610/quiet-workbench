# Asterism · 星序

Asterism is a local-first Obsidian workspace that turns projects, tasks, clients,
suppliers, meetings, and knowledge into a freely composed personal constellation
without moving business data out of Markdown files.

## Safety model

- The first launch is read-only.
- Business writes must be enabled explicitly in settings.
- Multi-file changes use preflight checks, receipts, and compensating restore.
- Configured template files are protected by the transaction layer and are always read-only.
- The plugin has no telemetry, accounts, network calls, or self-updater.

## Local installation

Run `pnpm install && pnpm verify`, then copy `main.js`, `manifest.json`, and
`styles.css` into `<vault>/.obsidian/plugins/quiet-workbench/`.

## 使用流程

1. 在 Obsidian 的「第三方插件」中启用 Asterism。
2. 先运行命令「刷新索引并运行诊断」；初始状态不会写入业务笔记。
3. 用 Ribbon 图标打开完整工作台，用命令「打开上下文侧栏」打开右侧面板。
4. 核对目录、模板和字段别名后，在插件设置中二次确认启用写入。
5. 原 `Workbench.md`、`Workbench Panel.md` 和 Homepage 配置不会自动删除或替换。

工作台只有一个自由页面，不再区分“今日执行 / 项目管理 / 知识整理”。升级时会把
上次使用的布局复制为唯一可见工作台，旧布局仅作为兼容备份保留。常规模式只显示业务
组件；点击顶部「编辑布局」后才显示添加、拖动、缩放、设置、折叠和隐藏操作。桌面端
可拖动和缩放，移动端使用排序、折叠和隐藏。布局撤销与业务事务撤销相互独立。

组件库采用 Apex 式的「组件类型 + 实例配置 + 推荐预设」模型。列表、看板、日历、
四象限、时间线、指标、详情、关系、选择器和快捷操作是可复用的组件类型；今日焦点、
等待事项、周任务、项目风险、项目健康度等是创建实例时可选的预设，不是在一个组件
里切换的标签页。相同类型可以重复添加，每个实例分别保存名称、数据源、数据范围、
客户、项目类型、任务来源和显示数量。旧的任务/项目功能组件会在加载布局时迁移为
对应类型和预设，原位置、尺寸与已有筛选配置保留。

项目组件共享同一个工作台内的项目选择状态。项目选择器负责搜索并发布当前项目；
项目摘要显示客户、类型、状态、阶段、目标日期、最近更新和明确下一步；项目健康度
根据目标日期、更新时间和任务逾期/积压情况生成只读信号；项目进度显示完成率、
未完成、逾期和未来 7 天任务数量。这些指标不回写项目文件，也不要求修改现有模板。

客户、会议和供应商同样以既有组件类型提供独立预设：列表、状态看板、日期视图、
详情、关系、选择器和快捷操作。会议行动支持批量迁移、逐条回执、幂等重跑和失败后
继续恢复。知识处理除了状态与项目关联，还支持先生成完整预览，再通过双文件事务创建
正式知识笔记；已有模板始终只读，留空时使用插件内置安全模板。

侧栏布局可在设置页用可视化控件添加、排序、隐藏、折叠和移除组件，原始 JSON 仍作为
高级导入/导出入口。YOLO 今日秘书和速记整理在打开对话前都会显示提示词预览；预览步骤
不修改 Markdown，用户确认后才复制提示词并调用公开命令。

今日执行中的「今日焦点」支持全部、逾期、今天和高优先快捷视图，并可按任务来源、
项目类型、客户、优先级和完成状态组合筛选。客户筛选使用可搜索、多选的选择器；
筛选条件只保存在布局配置中，不写入业务 Markdown。

「速记」继续使用独立的 `Quiet Workbench 速记.md`，以兼容已有数据和设置。每次输入会作为独立条目，
按本地日期分组并自动增加 `HH:mm` 时间戳；旧的无时间戳速记仍可读取。内容追加到设置中
配置的 Markdown 文件，走同一套冲突检查、事务回执和撤销机制。YOLO 按钮是可选增强：
可以从速记组件直接打开对应的 Markdown 文件；YOLO 按钮会打开当前速记并复制安全整理说明，
不访问其插件实例或内部 API；未安装 YOLO 时其他功能
继续正常运行。

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
