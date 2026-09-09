import type { TaskRecord } from "../core/types";
import { isClosedProjectStatus } from "./project-status";
import type { EntitySummary } from "../ui/controller";
import { calculateProjectHealth, dateAfter, effectiveTaskDate, isWaitingTask, type ProjectHealthResult } from "./widget-data";

export type ProjectReviewDecision = "已通过" | "附条件通过" | "暂缓" | "停止";

// Keep the stored key as `phase` for compatibility, while presenting one
// thermal-control development vocabulary everywhere the review flow edits it.
export const PROJECT_DEVELOPMENT_STAGES = [
  "方案定义",
  "设计定型",
  "投产制造",
  "集成实施",
  "试验验证",
  "在轨运行"
] as const;

export interface ProjectReviewTaskInput {
  text: string;
  due?: string;
}

export interface ProjectReviewInput {
  projectPath: string;
  decision: ProjectReviewDecision;
  phase?: string;
  nextAction?: string;
  reviewDue?: string;
  note?: string;
  task?: ProjectReviewTaskInput;
}

export interface ProjectReviewEvidence {
  project: EntitySummary;
  tasks: TaskRecord[];
  openTasks: TaskRecord[];
  overdueTasks: TaskRecord[];
  upcomingTasks: TaskRecord[];
  waitingTasks: TaskRecord[];
  meetings: EntitySummary[];
  assets: EntitySummary[];
  health: ProjectHealthResult;
  triggers: string[];
}

export function buildProjectReviewAiPrompt(evidence: ProjectReviewEvidence, today: string): string {
  return [
    "请使用 project-review 技能，在当前对话中持续协助我审阅这个项目。",
    "先根据当前项目笔记与 Asterism 证据包给出第一轮只读审阅，然后等待我的追问、补充证据和决定；不要把审阅当成一次性处理。",
    "不要修改任何文件、任务、状态、日期或审阅结论；需要修改时先给差异预览并等待我明确确认。",
    "请区分已确认事实、冲突、缺失证据、风险、待用户决定事项和建议，不要因为没有记录就断言没有开展。",
    `审阅基准日期：${today}`,
    "给出建议结论（通过、附条件通过、暂缓或停止）及理由，但明确标注为建议。",
    "后续对话继续沿用 project-review 的证据边界和安全规则。"
  ].join("\n");
}

export function serializeProjectReviewEvidence(evidence: ProjectReviewEvidence, today: string): string {
  const { project, health } = evidence;
  const lines = [
    "# Asterism 项目审阅证据包",
    "",
    `- 基准日期：${today}`,
    `- 项目：${project.name}`,
    `- 项目文件：${project.path}`,
    `- 客户：${project.client || "未记录"}`,
    `- 项目类型：${project.projectType || "未记录"}`,
    `- 业务类型：${project.businessType || "未记录"}`,
    `- 状态：${project.status || "未记录"}`,
    `- 研制阶段：${project.phase || "未记录"}`,
    `- 负责人：${project.owner || "未记录"}`,
    `- 下一步：${project.nextAction || project.detail || "未记录"}`,
    `- 等待事项：${project.waitingOn || "未记录"}`,
    `- 审阅触发：${evidence.triggers.join("；") || "手动审阅"}`,
    `- 当前健康判断：${health.level}`,
    `- 健康依据：${health.reasons.join("；") || "未发现显著风险信号"}`,
    `- 任务统计：共 ${evidence.tasks.length}，未完成 ${evidence.openTasks.length}，逾期 ${evidence.overdueTasks.length}，未来 7 天 ${evidence.upcomingTasks.length}，等待 ${evidence.waitingTasks.length}，完成率 ${health.progress}%`,
    "",
    "## 未完成任务"
  ];
  lines.push(...formatEvidenceTasks(evidence.openTasks));
  lines.push("", "## 关联会议");
  lines.push(...(evidence.meetings.length > 0
    ? evidence.meetings.slice(0, 8).map((meeting) => `- ${meeting.name}｜${meeting.path}｜${meeting.detail || meeting.related || "未填写摘要"}`)
    : ["- 无已索引的关联会议"]));
  lines.push("", "## 关联方案与资料");
  lines.push(...(evidence.assets.length > 0
    ? evidence.assets.slice(0, 12).map((asset) => `- ${asset.name}｜${asset.path}｜${asset.detail || asset.related || "项目关联资料"}`)
    : ["- 无已索引的关联方案或资料"]));
  return lines.join("\n");
}

function formatEvidenceTasks(tasks: readonly TaskRecord[]): string[] {
  if (tasks.length === 0) return ["- 无未完成任务"];
  return tasks.slice(0, 30).map((task) => {
    const date = effectiveTaskDate(task) || "未排期";
    return `- ${task.text}｜${date}｜${task.priority || "normal"}｜来源 ${task.sourceName}`;
  });
}

export function projectStatusForDecision(decision: ProjectReviewDecision): string {
  return {
    "已通过": "推进中",
    "附条件通过": "推进中",
    "暂缓": "暂停",
    "停止": "归档"
  }[decision];
}

export function projectReviewTriggers(
  project: EntitySummary,
  today: string,
  allTasks: readonly TaskRecord[] = []
): string[] {
  const triggers: string[] = [];
  if (project.reviewStatus === "待审议") triggers.push(project.reviewTrigger || "主动提交审阅");
  if (project.reviewDue && project.reviewDue <= today) triggers.push("已到复审日期");
  if (!isClosedProjectStatus(project.status)) {
    const openTasks = allTasks.filter((task) => task.scope === "project" && task.path === project.path && !task.completed);
    const overdue = openTasks.filter((task) => {
      const date = effectiveTaskDate(task);
      return Boolean(date && date < today);
    }).length;
    if (overdue > 0) triggers.push(`${overdue} 项任务逾期`);
    if (!project.nextAction?.trim() && openTasks.length === 0) triggers.push("缺少明确下一步");
  }
  return [...new Set(triggers)];
}

export function buildProjectReviewEvidence(
  project: EntitySummary,
  allTasks: readonly TaskRecord[],
  allMeetings: readonly EntitySummary[],
  today: string,
  now = Date.now(),
  allAssets: readonly EntitySummary[] = []
): ProjectReviewEvidence {
  const tasks = allTasks.filter((task) => task.scope === "project" && task.path === project.path);
  const openTasks = tasks.filter((task) => !task.completed);
  const weekEnd = dateAfter(today, 7);
  const overdueTasks = openTasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date < today);
  });
  const upcomingTasks = openTasks.filter((task) => {
    const date = effectiveTaskDate(task);
    return Boolean(date && date >= today && date <= weekEnd);
  });
  const waitingTasks = openTasks.filter(isWaitingTask);
  const meetings = allMeetings
    .filter((meeting) => entitySummaryReferencesProject(meeting, project))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const assets = allAssets
    .filter((asset) => entitySummaryReferencesProject(asset, project))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  return {
    project,
    tasks,
    openTasks,
    overdueTasks,
    upcomingTasks,
    waitingTasks,
    meetings,
    assets,
    // Project review deliberately ignores the project-level due field. Dates live on
    // executable tasks or review_due, so an old project due cannot distort health.
    health: calculateProjectHealth({ ...project, due: undefined }, tasks, today, now),
    triggers: projectReviewTriggers(project, today, allTasks)
  };
}

export function projectReviewCandidates(
  projects: readonly EntitySummary[],
  today: string,
  allTasks: readonly TaskRecord[] = []
): EntitySummary[] {
  return projects
    .filter((project) => projectReviewTriggers(project, today, allTasks).length > 0)
    .sort((left, right) => {
      const leftPriority = reviewPriority(left, today, allTasks);
      const rightPriority = reviewPriority(right, today, allTasks);
      return leftPriority - rightPriority
        || (left.reviewDue || "9999-12-31").localeCompare(right.reviewDue || "9999-12-31")
        || left.name.localeCompare(right.name, "zh-CN");
    });
}

export function validateProjectReviewInput(input: ProjectReviewInput): void {
  if (!input.projectPath.trim()) throw new Error("请选择需要审阅的项目。");
  if (!(["已通过", "附条件通过", "暂缓", "停止"] as string[]).includes(input.decision)) {
    throw new Error("不支持的项目审阅结论。");
  }
  if (input.decision === "附条件通过" && !input.reviewDue) {
    throw new Error("附条件通过需要填写复审日期。");
  }
  if (input.reviewDue && !/^\d{4}-\d{2}-\d{2}$/u.test(input.reviewDue)) {
    throw new Error("复审日期应使用 YYYY-MM-DD 格式。");
  }
  if (input.task?.due && !/^\d{4}-\d{2}-\d{2}$/u.test(input.task.due)) {
    throw new Error("任务日期应使用 YYYY-MM-DD 格式。");
  }
  if (input.task && !input.task.text.trim()) throw new Error("任务内容不能为空。");
}

function reviewPriority(project: EntitySummary, today: string, allTasks: readonly TaskRecord[]): number {
  if (project.reviewStatus === "待审议") return 0;
  if (project.reviewDue && project.reviewDue <= today) return 1;
  const triggers = projectReviewTriggers(project, today, allTasks);
  if (triggers.some((trigger) => trigger.includes("任务逾期"))) return 2;
  return 3;
}

function entitySummaryReferencesProject(candidate: EntitySummary, project: EntitySummary): boolean {
  const normalize = (value: string) => value.trim().replace(/\.md$/iu, "").normalize("NFC").toLocaleLowerCase("zh-CN");
  const targets = new Set([project.name, project.path, ...(project.aliases ?? [])].map(normalize));
  const values = [candidate.project, candidate.related].filter((value): value is string => Boolean(value));
  for (const value of values) {
    const links = [...value.matchAll(/\[\[([^\]]+)\]\]/gu)];
    const references = links.length ? links.map((match) => match[1].split("|")[0].split("#")[0]) : value.split(/[、,，;]/u);
    if (references.some((reference) => targets.has(normalize(reference)))) return true;
  }
  // Prose may contain an explicit wikilink, but shared words alone are not evidence.
  return [...(candidate.detail ?? "").matchAll(/\[\[([^\]]+)\]\]/gu)]
    .some((match) => targets.has(normalize(match[1].split("|")[0].split("#")[0])));
}

/** Display only. Preserve the full original task text for writes and source navigation. */
export function reviewTaskTitle(text: string, projectName: string): string {
  const title = text.replace(/\[\[([^\]]+)\]\]/gu, (_match, link: string) => {
    const [target, alias] = link.split("|");
    const name = target.split("/").pop()?.replace(/\.md$/iu, "");
    return name === projectName ? "" : alias || name || target;
  }).replace(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu, " ").replace(/\s+/gu, " ").trim();
  return title || text;
}
