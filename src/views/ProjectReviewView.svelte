<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setIcon } from "obsidian";
  import {
    buildProjectReviewEvidence,
    PROJECT_DEVELOPMENT_STAGES,
    projectReviewCandidates,
    projectReviewTriggers,
    projectStatusForDecision,
    reviewTaskTitle,
    type ProjectReviewDecision
  } from "../domain/project-review";
  import { isPreSalesProject, matchesProjectType, normalizeProjectType, PROJECT_TYPES, type ProjectType } from "../domain/project-type";
  import type { TaskRecord } from "../core/types";
  import { effectiveTaskDate } from "../domain/widget-data";
  import { formatDate } from "../services/template-service";
  import { EMPTY_SNAPSHOT, type EntitySummary, type WorkbenchController, type WorkbenchSnapshot } from "../ui/controller";

  export let controller: WorkbenchController;

  const standardDecisions: Array<{ value: ProjectReviewDecision; label: string; hint: string }> = [
    { value: "已通过", label: "通过", hint: "继续推进" },
    { value: "附条件通过", label: "附条件", hint: "补齐条件后推进" },
    { value: "暂缓", label: "暂缓", hint: "等待条件成熟" },
    { value: "停止", label: "停止", hint: "结束投入并归档" }
  ];
  const presalesDecisions: Array<{ value: ProjectReviewDecision; label: string; hint: string }> = [
    { value: "已通过", label: "继续售前", hint: "保持售前方案" },
    { value: "赢单转交付", label: "赢单转交付", hint: "进入合同交付" },
    { value: "暂缓", label: "暂缓", hint: "等待客户或条件" },
    { value: "停止", label: "关闭", hint: "结束跟进并归档" }
  ];
  let snapshot: WorkbenchSnapshot = controller.getSnapshot() ?? EMPTY_SNAPSHOT;
  let unsubscribe = () => {};
  let selectedPath = "";
  let query = "";
  let projectTypeFilter: "全部" | ProjectType = "全部";
  let reviewed = new Set<string>();
  let queueOrder: string[] = [];
  let decision: ProjectReviewDecision | "" = "";
  let phase = "";
  let nextAction = "";
  let reviewDue = "";
  let note = "";
  let taskText = "";
  let taskDue = "";
  let editingTaskId = "";
  let taskEditDue = "";
  let taskEditScheduled = "";
  let showAllTasks = false;
  let showNewTask = false;
  let taskEditPriority: NonNullable<TaskRecord["priority"]> = "normal";
  let taskBusyId = "";
  let busy = false;
  let message = "";
  let messageTone: "ok" | "error" = "ok";

  $: today = formatDate(new Date(), "YYYY-MM-DD");
  $: candidates = projectReviewCandidates(snapshot.projects, today, snapshot.tasks);
  $: candidatePaths = candidates.map((project) => project.path);
  $: filteredCandidates = candidates.filter((project) => matchesProjectType(project.projectType, projectTypeFilter));
  $: filteredCandidatePaths = filteredCandidates.map((project) => project.path);
  $: projectTypeCounts = Object.fromEntries(PROJECT_TYPES.map((projectType) => [
    projectType,
    candidates.filter((project) => normalizeProjectType(project.projectType) === projectType).length
  ])) as Record<ProjectType, number>;
  $: queue = queueOrder
    .filter((path) => !reviewed.has(path))
    .map((path) => snapshot.projects.find((project) => project.path === path))
    .filter((project): project is EntitySummary => Boolean(project)
      && matchesProjectType(project?.projectType, projectTypeFilter));
  $: visibleProjects = snapshot.projects.filter((project) => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return matchesProjectType(project.projectType, projectTypeFilter)
      && (!needle || `${project.name} ${project.client ?? ""} ${project.projectType ?? ""} ${project.status ?? ""} ${project.phase ?? ""}`.toLocaleLowerCase("zh-CN").includes(needle));
  });
  $: selectableProjects = query ? visibleProjects : queue;
  $: selected = selectableProjects.find((project) => project.path === selectedPath) ?? selectableProjects[0];
  $: if (selected && selectedPath !== selected.path) selectProject(selected.path);
  $: evidence = selected
    ? buildProjectReviewEvidence(selected, snapshot.tasks, snapshot.meetings, today, Date.now(), snapshot.knowledge)
    : undefined;
  $: totalCandidateCount = candidatePaths.length;
  $: pendingCount = filteredCandidatePaths.filter((path) => !reviewed.has(path)).length;
  $: reviewedCount = filteredCandidatePaths.filter((path) => reviewed.has(path)).length;
  $: reviewDueRequired = decision === "附条件通过";
  $: canSave = Boolean(selected && decision && (!reviewDueRequired || reviewDue));
  $: mappedStatus = decision ? projectStatusForDecision(decision) : selected?.status || "未设置";
  $: decisionOptions = isPreSalesProject(selected?.projectType) ? presalesDecisions : standardDecisions;
  $: phaseOptions = PROJECT_DEVELOPMENT_STAGES.includes(phase as typeof PROJECT_DEVELOPMENT_STAGES[number])
    ? [...PROJECT_DEVELOPMENT_STAGES]
    : [phase, ...PROJECT_DEVELOPMENT_STAGES].filter(Boolean);

  function obsidianIcon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(next: string) { setIcon(node, next); } };
  }

  function reconcileQueue(current: string[], paths: string[]): string[] {
    const retained = current.filter((path) => paths.includes(path));
    return [...retained, ...paths.filter((path) => !retained.includes(path))];
  }

  function chooseProjectTypeFilter(value: "全部" | ProjectType): void {
    projectTypeFilter = value;
    query = "";
    const next = candidates.find((project) => !reviewed.has(project.path)
      && (value === "全部" || normalizeProjectType(project.projectType) === value));
    selectedPath = next?.path ?? "";
  }

  function selectProject(path: string): void {
    selectedPath = path;
    const project = snapshot.projects.find((entry) => entry.path === path);
    decision = "";
    showAllTasks = false;
    showNewTask = false;
    phase = project?.phase ?? "";
    nextAction = project?.nextAction ?? "";
    reviewDue = project?.reviewDue ?? "";
    note = project?.reviewNote ?? "";
    taskText = "";
    taskDue = "";
    editingTaskId = "";
    message = "";
  }

  function phaseOptionLabel(value: string): string {
    return PROJECT_DEVELOPMENT_STAGES.includes(value as typeof PROJECT_DEVELOPMENT_STAGES[number])
      ? value
      : `${value}（现有）`;
  }

  function healthLabel(): string {
    if (!evidence) return "待读取";
    return { healthy: "健康", attention: "需关注", risk: "有风险", unknown: "待补充" }[evidence.health.level];
  }

  function scopeDate(task: WorkbenchSnapshot["tasks"][number]): string {
    return effectiveTaskDate(task) ?? "未排期";
  }

  function localDateTime(value?: number): string {
    if (!value) return "未记录";
    return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  }

  function projectTrigger(project: EntitySummary): string {
    return projectReviewTriggers(project, today, snapshot.tasks)[0] || "手动查看";
  }

  function chooseDecision(value: ProjectReviewDecision): void {
    decision = value;
    if (value === "已通过" || value === "赢单转交付" || value === "停止") reviewDue = "";
    if (value === "赢单转交付") phase = "方案定义";
  }

  function beginTaskUpdate(task: TaskRecord): void {
    editingTaskId = editingTaskId === task.id ? "" : task.id;
    taskEditDue = task.due ?? "";
    taskEditScheduled = task.scheduled ?? "";
    taskEditPriority = task.priority ?? "normal";
  }

  async function toggleTask(task: TaskRecord): Promise<void> {
    if (busy || taskBusyId || task.scope === "meeting-draft") return;
    taskBusyId = task.id;
    message = "";
    try {
      await controller.updateTask(task, { completed: !task.completed });
      messageTone = "ok";
      message = task.completed ? "任务已重新打开。" : "任务已标记完成。";
      editingTaskId = "";
    } catch (error) {
      messageTone = "error";
      message = error instanceof Error ? error.message : String(error);
    } finally {
      taskBusyId = "";
    }
  }

  async function saveTaskUpdate(task: TaskRecord): Promise<void> {
    if (busy || taskBusyId) return;
    taskBusyId = task.id;
    message = "";
    try {
      await controller.updateTask(task, { due: taskEditDue || null, scheduled: taskEditScheduled || null, priority: taskEditPriority });
      messageTone = "ok";
      message = "任务日期和优先级已更新。";
      editingTaskId = "";
    } catch (error) {
      messageTone = "error";
      message = error instanceof Error ? error.message : String(error);
    } finally {
      taskBusyId = "";
    }
  }

  function advance(markReviewed: boolean): void {
    if (!selected) return;
    if (markReviewed) reviewed = new Set([...reviewed, selected.path]);
    else queueOrder = [...queueOrder.filter((path) => path !== selected.path), selected.path];
    const next = queueOrder.find((path) => path !== selected.path && !reviewed.has(path));
    if (next) selectProject(next);
    else selectedPath = "";
  }

  async function saveReview(): Promise<void> {
    if (!selected || !decision || busy || taskBusyId || !canSave) return;
    const savingProject = selected;
    busy = true;
    message = "";
    try {
      await controller.saveProjectReview({
        projectPath: selected.path,
        decision,
        currentProjectType: selected.projectType,
        phase: phase.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        reviewDue: reviewDue || undefined,
        note: note.trim() || undefined,
        task: showNewTask && taskText.trim() ? { text: taskText.trim(), due: taskDue || undefined } : undefined
      });
      messageTone = "ok";
      message = `已保存「${savingProject.name}」的审阅结论。`;
      reviewed = new Set([...reviewed, savingProject.path]);
      const next = queueOrder.find((path) => path !== savingProject.path && !reviewed.has(path));
      if (next) selectProject(next);
      else selectedPath = "";
    } catch (error) {
      messageTone = "error";
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function refresh(): Promise<void> {
    busy = true;
    message = "";
    try {
      await controller.refresh();
      messageTone = "ok";
      message = "项目证据已刷新。";
    } catch (error) {
      messageTone = "error";
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function openYoloReview(): Promise<void> {
    if (!selected || busy) return;
    busy = true;
    message = "";
    try {
      await controller.openProjectReviewInYolo(selected.path);
      messageTone = "ok";
      message = "已打开 YOLO 新对话并复制 project-review 审阅说明；请在对话框粘贴发送，之后可持续追问和补充证据。";
    } catch (error) {
      messageTone = "error";
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    unsubscribe = controller.subscribe((next) => {
      snapshot = next;
      const nextToday = formatDate(new Date(), "YYYY-MM-DD");
      queueOrder = reconcileQueue(queueOrder, projectReviewCandidates(next.projects, nextToday, next.tasks).map((project) => project.path));
    });
  });
  onDestroy(() => unsubscribe());
</script>

<div class="review-shell">
  <header class="review-header">
    <div class="review-heading">
      <span class="eyebrow">ASTERISM · PROJECT REVIEW</span>
      <h1>项目审阅</h1>
      <p>看清事实，调整项目，然后继续下一项。</p>
    </div>
    <div class="review-header-actions qwb-page-nav" role="toolbar" aria-label="Asterism 页面导航与项目审阅操作">
      <span class:enabled={controller.settings.writesEnabled} class="write-state"><i></i>{controller.settings.writesEnabled ? "可写入" : "只读诊断"}</span>
      <span class="qwb-page-nav-divider" aria-hidden="true"></span>
      <button class="icon-button" title="工作台" aria-label="打开工作台" on:click={() => controller.openWorkbench()}><i use:obsidianIcon={"asterism-mark"}></i></button>
      <button class="icon-button" title="任务看板" aria-label="打开任务看板" on:click={() => controller.openTaskBoard()}><i use:obsidianIcon={"list-todo"}></i></button>
      <button class="icon-button is-current" title="项目审阅" aria-label="当前页面：项目审阅" aria-current="page" on:click={() => controller.openProjectReview()}><i use:obsidianIcon={"clipboard-check"}></i></button>
      <button class="icon-button" title="上下文侧栏" aria-label="打开上下文侧栏" on:click={() => controller.openContextPanel()}><i use:obsidianIcon={"panel-right-open"}></i></button>
      <span class="qwb-page-nav-divider" aria-hidden="true"></span>
      <button class="icon-button" title="刷新证据" aria-label="刷新证据" disabled={busy} on:click={refresh}><i use:obsidianIcon={"refresh-cw"}></i></button>
    </div>
  </header>

  <section class="review-summary" aria-label="审阅队列概览">
    <div><span use:obsidianIcon={"inbox"}></span><b>{pendingCount}</b><small>待处理</small></div>
    <div><span use:obsidianIcon={"check-check"}></span><b>{reviewedCount}</b><small>{projectTypeFilter === "全部" ? "本轮已阅" : "本类已阅"}</small></div>
    <div><span use:obsidianIcon={"files"}></span><b>{totalCandidateCount}</b><small>全部候选</small></div>
  </section>

  {#if message}<div class:error={messageTone === "error"} class="review-message" role={messageTone === "error" ? "alert" : "status"} aria-live="polite">{message}</div>{/if}

  <div class="review-layout">
    <aside class="review-queue">
      <div class="queue-heading"><div><span>审阅队列</span><strong>{queue.length}</strong></div><small>候选项目优先；可搜索当前类型的全部项目</small></div>
      <div class="project-type-filters" role="group" aria-label="按项目类型筛选审阅队列">
        <button type="button" class:active={projectTypeFilter === "全部"} aria-pressed={projectTypeFilter === "全部"} on:click={() => chooseProjectTypeFilter("全部")}><span>全部</span><small>{totalCandidateCount}</small></button>
        {#each PROJECT_TYPES as projectType}
          <button type="button" class:active={projectTypeFilter === projectType} aria-pressed={projectTypeFilter === projectType} on:click={() => chooseProjectTypeFilter(projectType)}><span>{projectType}</span><small>{projectTypeCounts[projectType]}</small></button>
        {/each}
      </div>
      <label class="project-search"><i use:obsidianIcon={"search"}></i><input bind:value={query} type="search" placeholder="搜索项目、客户或研制阶段" /></label>
      <div class="queue-list">
        {#each (query ? visibleProjects : queue) as project (project.path)}
          <button class:active={selected?.path === project.path} on:click={() => selectProject(project.path)}>
            <span class="queue-icon" use:obsidianIcon={"folder-kanban"}></span>
            <span class="queue-copy">
              <strong>{project.name}</strong>
              <small>{project.client || project.projectType || "未关联客户"}<em>{projectTrigger(project)}</em></small>
            </span>
          </button>
        {:else}
          <div class="queue-empty"><span use:obsidianIcon={"circle-check-big"}></span><strong>当前类型已清空</strong><small>切换项目类型，或搜索项目继续查看。</small></div>
        {/each}
      </div>
    </aside>

    {#if selected && evidence}
      <main class="review-main">
        <section class="project-hero">
          <div class="project-title-row">
            <div>
              <span class="project-kicker">{selected.projectType || "项目"} · {selected.client || "内部项目"}</span>
              <h2>{selected.name}</h2>
              <div class="project-badges"><span>{selected.status || "未设置状态"}</span><span>{selected.phase || "未设置研制阶段"}</span><span class={evidence.health.level}>{healthLabel()}</span></div>
            </div>
            <div class="project-actions">
              <button on:click={() => controller.openPath(selected!.path)}><i use:obsidianIcon={"file-text"}></i>打开项目</button>
              <button class="ai-action" disabled={busy} title="复制结构化审阅证据并在 YOLO 中开启持续对话" on:click={openYoloReview}><i use:obsidianIcon={"message-square-more"}></i>YOLO 审阅</button>
            </div>
          </div>
          <div class="project-facts">
            <div><small>负责人</small><strong>{selected.owner || "待确认"}</strong></div>
            <div><small>最近更新</small><strong>{localDateTime(selected.updatedAt)}</strong></div>
            <div><small>审阅触发</small><strong>{evidence.triggers.join("；") || "手动查看"}</strong></div>
          </div>
        </section>

        <section class="review-grid">
          <article class="review-card project-core">
            <header><span use:obsidianIcon={"target"}></span><div><h3>项目现状</h3></div></header>
            <dl>
              <div><dt>当前目标</dt><dd>{selected.detail || selected.nextAction || "项目页尚未填写明确下一步。"}</dd></div>
              <div><dt>等待事项</dt><dd>{selected.waitingOn || (evidence.waitingTasks[0]?.text ?? "没有识别到明确等待项。")}</dd></div>
              <div><dt>健康依据</dt><dd>{evidence.health.reasons.join("；") || "未发现显著延期、积压或更新风险。"}</dd></div>
            </dl>
          </article>

          <article class="review-card metrics-card">
            <header><span use:obsidianIcon={"chart-no-axes-column-increasing"}></span><div><h3>任务概况</h3></div></header>
            <div class="metric-grid">
              <div class:risk={evidence.health.overdue > 0}><strong>{evidence.health.overdue}</strong><span>逾期</span></div>
              <div><strong>{evidence.health.dueSoon}</strong><span>未来 7 天</span></div>
              <div><strong>{evidence.waitingTasks.length}</strong><span>等待</span></div>
              <div><strong>{evidence.health.progress}%</strong><span>完成率</span></div>
            </div>
          </article>

          <article class="review-card task-evidence">
            <header><span use:obsidianIcon={"list-checks"}></span><div><h3>未完成任务</h3><small>逾期优先 · 完成和调整即时保存</small></div><b>{evidence.openTasks.length}</b></header>
            <div class="evidence-list">
              {#each [...evidence.overdueTasks, ...evidence.upcomingTasks, ...evidence.openTasks.filter((task) => !evidence.overdueTasks.includes(task) && !evidence.upcomingTasks.includes(task))].slice(0, showAllTasks ? undefined : 6) as task (task.id)}
                <div class="task-evidence-item">
                  <div class="task-evidence-row">
                    <button class="task-complete" aria-label={`完成任务：${task.text}`} title="标记完成" disabled={busy || Boolean(taskBusyId) || !controller.settings.writesEnabled} on:click={() => toggleTask(task)}><span use:obsidianIcon={taskBusyId === task.id ? "loader-circle" : "circle"} class:spinning={taskBusyId === task.id}></span></button>
                    <button class="task-open" on:click={() => controller.openPath(task.path)}><i class:overdue={Boolean(effectiveTaskDate(task) && effectiveTaskDate(task)! < today)}></i><span><strong>{reviewTaskTitle(task.text, selected.name)}</strong></span></button>
                    <time class:overdue={Boolean(effectiveTaskDate(task) && effectiveTaskDate(task)! < today)}>{effectiveTaskDate(task) && effectiveTaskDate(task)! < today ? "逾期 · " : ""}{task.scheduled ? "计划 " : task.due ? "截止 " : ""}{scopeDate(task)}</time>
                    <button class="task-adjust" aria-expanded={editingTaskId === task.id} on:click={() => beginTaskUpdate(task)}>{editingTaskId === task.id ? "收起" : "调整"}</button>
                  </div>
                  {#if editingTaskId === task.id}
                    <div class="task-quick-editor">
                      <label><span>计划日期</span><input type="date" bind:value={taskEditScheduled} /></label><label><span>截止日期</span><input type="date" bind:value={taskEditDue} /></label>
                      <label><span>优先级</span><select bind:value={taskEditPriority}><option value="highest">最高</option><option value="high">高</option><option value="normal">普通</option><option value="low">低</option><option value="lowest">最低</option></select></label>
                      <button class="task-save" disabled={busy || Boolean(taskBusyId) || !controller.settings.writesEnabled} on:click={() => saveTaskUpdate(task)}>保存调整</button>
                    </div>
                  {/if}
                </div>
              {:else}<p class="empty-text">项目页没有未完成任务。</p>{/each}
            </div>
            {#if evidence.openTasks.length > 6}<button class="review-text-button" on:click={() => showAllTasks = !showAllTasks}>{showAllTasks ? "收起任务" : `查看全部 ${evidence.openTasks.length} 项任务`}</button>{/if}
            <button class="review-text-button" aria-expanded={showNewTask} on:click={() => showNewTask = !showNewTask}>{showNewTask ? "取消新增任务" : "新增任务"}</button>
            {#if showNewTask}<div class="task-fields">
              <label><span>任务内容</span><input bind:value={taskText} placeholder="输入明确、可执行的任务" /></label>
              <label><span>截止日期（可选）</span><input bind:value={taskDue} type="date" /></label>
              <small>随本次审阅一起保存</small>
            </div>{/if}
          </article>

          <article class="review-card meeting-evidence">
            <header><span use:obsidianIcon={"calendar-days"}></span><div><h3>关联会议</h3></div><b>{evidence.meetings.length}</b></header>
            <div class="evidence-list">
              {#each evidence.meetings.slice(0, 6) as meeting (meeting.path)}
                <button on:click={() => controller.openPath(meeting.path)}><span class="meeting-mark" use:obsidianIcon={"messages-square"}></span><span><strong>{meeting.name}</strong><small>{meeting.detail || meeting.related || "关联会议"}</small></span><time>{localDateTime(meeting.updatedAt)}</time></button>
              {:else}<p class="empty-text">暂无关联会议。</p>{/each}
            </div>
          </article>

          <article class="review-card asset-evidence">
            <header><span use:obsidianIcon={"notebook-tabs"}></span><div><h3>方案与项目笔记</h3></div><b>{evidence.assets.length}</b></header>
            <div class="evidence-list">
              {#each evidence.assets.slice(0, 6) as asset (asset.path)}
                <button on:click={() => controller.openPath(asset.path)}><span class="meeting-mark" use:obsidianIcon={"file-text"}></span><span><strong>{asset.name}</strong><small>{asset.detail || asset.related || "项目关联资料"}</small></span><time>{localDateTime(asset.updatedAt)}</time></button>
              {:else}<p class="empty-text">暂无关联方案或项目笔记。</p>{/each}
            </div>
          </article>
        </section>

        <section class="decision-card" aria-labelledby="review-decision-title">
          <header>
            <div><h3 id="review-decision-title">结论与项目调整</h3></div>
          </header>
          <fieldset class="decision-options">
            <legend>审阅结论</legend>
            {#each decisionOptions as option}
              <button type="button" class:active={decision === option.value} aria-pressed={decision === option.value} on:click={() => chooseDecision(option.value)}><span>{option.label}</span><small>{option.hint}</small></button>
            {/each}
          </fieldset>
          {#if decision && (mappedStatus !== selected.status || decision === "赢单转交付")}
            <p class:conversion={decision === "赢单转交付"} class="status-change" aria-live="polite">
              {#if decision === "赢单转交付"}项目类型：{normalizeProjectType(selected.projectType) || selected.projectType || "未设置"} → 合同交付{/if}
              {#if mappedStatus !== selected.status}{decision === "赢单转交付" ? "；" : ""}项目状态：{selected.status || "未设置"} → {mappedStatus}{/if}
            </p>
          {/if}
          <div class="project-update-fields">
            <label><span>研制阶段</span><select bind:value={phase} aria-label="研制阶段"><option value="">未设置</option>{#each phaseOptions as option}<option value={option}>{phaseOptionLabel(option)}</option>{/each}</select></label>
            <label class="next-action-field"><span>下一步</span><input bind:value={nextAction} placeholder="项目层面的明确下一步" /></label>
          </div>
          <div class="decision-fields">
            {#if decision === "附条件通过" || decision === "暂缓"}
              <label><span>下次复审{reviewDueRequired ? "（必填）" : "（可选）"}</span><input bind:value={reviewDue} type="date" aria-required={reviewDueRequired} /></label>
            {/if}
            <label class="decision-note"><span>审阅意见</span><textarea bind:value={note} rows="3" placeholder="关键判断、附加条件或需要补齐的证据"></textarea></label>
          </div>
          <footer><small>保存后保留审阅记录</small><button type="button" disabled={busy || Boolean(taskBusyId)} on:click={() => advance(false)}>跳过</button><button class="primary" disabled={busy || Boolean(taskBusyId) || !controller.settings.writesEnabled || !canSave} on:click={saveReview}>{busy ? "保存中…" : "保存并审下一个"}</button></footer>
        </section>

      </main>
    {:else}
      <main class="review-main empty-main"><span use:obsidianIcon={"circle-check-big"}></span><h2>{query ? "没有匹配的项目" : "本轮审阅已完成"}</h2><p>{query ? "换一个项目名、客户或阶段试试。" : "队列会在待审议、复审到期、任务逾期或缺少下一步时重新出现项目。"}</p></main>
    {/if}
  </div>
</div>

<style>
  :global(.asterism-project-review-host) { padding: 0 !important; overflow: auto; background: var(--background-primary); }
  .review-shell { --review-accent: var(--interactive-accent); --review-line: color-mix(in srgb, var(--background-modifier-border) 80%, transparent); width: 100%; max-width: 1840px; min-width: 760px; min-height: 100%; margin: 0 auto; padding: clamp(18px, 2vw, 28px); color: var(--text-normal); background: var(--background-primary); box-sizing: border-box; }
  button, input { font: inherit; }
  button { color: inherit; box-shadow: none !important; }
  .review-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 25px 28px; border: 1px solid var(--review-line); border-radius: 20px; background: var(--background-secondary); }
  .eyebrow { display: block; color: var(--text-accent); font-size: 11px; font-weight: 800; letter-spacing: .16em; }
  .review-heading h1 { margin: 9px 0 4px; font-size: clamp(34px, 4vw, 56px); line-height: 1; letter-spacing: -.045em; }
  .review-heading p { margin: 0; color: var(--text-muted); font-size: 15px; }
  .review-header-actions { display: flex; align-items: center; gap: 8px; }
  .write-state { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 13px; border: 1px solid var(--review-line); border-radius: 999px; background: var(--background-primary); color: var(--text-muted); font-size: 12px; font-weight: 700; }
  .write-state i { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
  .write-state.enabled i { background: var(--color-green); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-green) 14%, transparent); }
  .icon-button { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--review-line); border-radius: 11px; background: var(--background-primary); cursor: pointer; }
  .icon-button i, .review-card > header > span, .project-actions i { width: 17px; height: 17px; }
  .review-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
  .review-summary > div { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 10px; min-height: 50px; padding: 8px 15px; border: 1px solid var(--review-line); border-radius: 13px; background: var(--background-secondary); }
  .review-summary span { width: 17px; height: 17px; color: var(--text-accent); }
  .review-summary b { font-size: 20px; }
  .review-summary small { color: var(--text-muted); }
  .review-message { margin: 10px 0; padding: 11px 14px; border: 1px solid color-mix(in srgb, var(--color-green) 35%, var(--review-line)); border-radius: 12px; background: color-mix(in srgb, var(--color-green) 8%, var(--background-secondary)); }
  .review-message.error { border-color: color-mix(in srgb, var(--color-red) 40%, var(--review-line)); background: color-mix(in srgb, var(--color-red) 8%, var(--background-secondary)); }
  .review-layout { display: grid; grid-template-columns: minmax(280px, 310px) minmax(0, 1fr); gap: 18px; align-items: start; }
  .review-queue, .project-hero, .review-card, .decision-card, .empty-main { border: 1px solid var(--review-line); border-radius: 16px; background: var(--background-secondary); }
  .review-queue { position: sticky; top: 18px; display: flex; flex-direction: column; height: min(760px, calc(100vh - 84px)); min-height: 540px; overflow: hidden; }
  .queue-heading { padding: 17px 16px 12px; border-bottom: 1px solid var(--review-line); }
  .queue-heading > div { display: flex; align-items: center; justify-content: space-between; }
  .queue-heading span { font-weight: 800; }
  .queue-heading strong { display: grid; place-items: center; min-width: 25px; height: 25px; border-radius: 999px; background: color-mix(in srgb, var(--review-accent) 12%, transparent); color: var(--text-accent); font-size: 12px; }
  .queue-heading small { color: var(--text-muted); }
  .project-search { display: flex; align-items: center; gap: 8px; margin: 12px; padding: 0 10px; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); }
  .project-search i { width: 15px; height: 15px; color: var(--text-muted); }
  .project-search input { width: 100%; height: 36px; padding: 0; border: 0; background: transparent; box-shadow: none; }
  .queue-list { flex: 1; min-height: 0; padding: 0 10px 12px; overflow: auto; scrollbar-gutter: stable; }
  .queue-list > button { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; width: 100%; height: auto !important; min-height: 58px !important; margin: 0 0 5px; padding: 9px 10px !important; overflow: hidden; border: 1px solid transparent; border-radius: 11px; background: transparent; text-align: left; cursor: pointer; }
  .queue-list > button:hover { background: var(--background-modifier-hover); }
  .queue-list > button.active { border-color: color-mix(in srgb, var(--review-accent) 36%, var(--review-line)); background: color-mix(in srgb, var(--review-accent) 9%, var(--background-secondary)); }
  .queue-icon { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 9px; color: var(--text-accent); background: color-mix(in srgb, var(--review-accent) 11%, var(--background-primary)); }
  .queue-icon :global(svg) { width: 15px; height: 15px; }
  .queue-copy { min-width: 0; }
  .queue-list strong, .queue-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .queue-list strong { font-size: 13px; line-height: 1.35; }
  .queue-list small { margin-top: 4px; color: var(--text-muted); font-size: 10px; line-height: 1.3; }
  .queue-list em { margin-left: 6px; color: var(--text-accent); font-size: 10px; font-style: normal; }
  .queue-empty { display: grid; justify-items: center; gap: 7px; padding: 38px 14px; color: var(--text-muted); text-align: center; }
  .queue-empty span { width: 28px; height: 28px; color: var(--color-green); }
  .review-main { min-width: 0; }
  .project-hero { padding: 22px; }
  .project-title-row { display: flex; justify-content: space-between; gap: 18px; }
  .project-kicker { color: var(--text-muted); font-size: 12px; font-weight: 700; }
  .project-title-row h2 { margin: 5px 0 9px; font-size: clamp(24px, 3vw, 36px); line-height: 1.08; letter-spacing: -.03em; }
  .project-badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .project-badges span { padding: 4px 8px; border-radius: 999px; background: var(--background-primary); color: var(--text-muted); font-size: 11px; font-weight: 700; }
  .project-badges span.healthy { color: var(--color-green); }
  .project-badges span.attention { color: var(--color-orange); }
  .project-badges span.risk { color: var(--color-red); }
  .project-actions { display: flex; align-items: flex-start; gap: 6px; }
  .project-actions button { display: inline-flex; align-items: center; gap: 6px; height: auto !important; min-height: 36px; padding: 0 11px; border: 1px solid var(--review-line); border-radius: 9px; background: var(--background-primary); font-size: 12px; font-weight: 700; cursor: pointer; }
  .project-actions .ai-action { border-color: color-mix(in srgb, var(--review-accent) 42%, var(--review-line)); color: var(--text-accent); }
  .spinning { animation: review-spin .9s linear infinite; }
  .project-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin-top: 18px; overflow: hidden; border: 1px solid var(--review-line); border-radius: 12px; background: var(--review-line); }
  .project-facts div { min-width: 0; padding: 11px 12px; background: var(--background-primary); }
  .project-facts small, .project-facts strong { display: block; }
  .project-facts small { color: var(--text-muted); font-size: 10px; }
  .project-facts strong { margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .decision-fields input { height: 38px; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); }
  .review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
  .review-card { min-width: 0; padding: 19px; overflow: hidden; }
  .review-card > header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .review-card > header > span { color: var(--text-accent); }
  .review-card h3 { margin: 0; font-size: 15px; }
  .review-card header small { display: block; color: var(--text-muted); font-size: 10px; }
  .review-card header b { margin-left: auto; color: var(--text-muted); font-size: 12px; }
  .project-core dl { display: grid; gap: 9px; margin: 0; }
  .project-core dl div { padding: 10px 11px; border: 1px solid var(--review-line); border-radius: 11px; background: var(--background-primary); }
  .project-core dt { color: var(--text-muted); font-size: 10px; font-weight: 700; }
  .project-core dd { margin: 3px 0 0; font-size: 12px; line-height: 1.5; }
  .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .metric-grid div { display: grid; gap: 3px; min-height: 78px; align-content: center; justify-items: center; border: 1px solid var(--review-line); border-radius: 12px; background: var(--background-primary); }
  .metric-grid strong { font-size: 25px; }
  .metric-grid span { color: var(--text-muted); font-size: 10px; }
  .metric-grid div.risk strong { color: var(--color-red); }
  .evidence-list { display: grid; gap: 6px; }
  .evidence-list > button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; height: auto !important; min-height: 52px !important; padding: 9px 10px !important; overflow: hidden; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); text-align: left; cursor: pointer; }
  .evidence-list .task-open > i:not(.meeting-mark) { width: 8px; height: 8px; border-radius: 50%; background: var(--color-blue); }
  .evidence-list .task-open > i.overdue { background: var(--color-red); }
  .meeting-mark { width: 17px; height: 17px; color: var(--text-accent); }
  .evidence-list button span { min-width: 0; }
  .evidence-list strong, .evidence-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .evidence-list strong { font-size: 12px; }
  .evidence-list small, .evidence-list time { color: var(--text-muted); font-size: 10px; }
  .empty-text { margin: 8px 0; color: var(--text-muted); font-size: 12px; }
  .decision-card { margin-top: 18px; padding: 22px; }
  .decision-card > header { display: flex; justify-content: space-between; gap: 18px; }
  .decision-card h3 { margin: 5px 0 3px; font-size: 20px; }
  .decision-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 17px; }
  .decision-options button { display: grid; align-content: center; gap: 4px; height: auto !important; min-height: 58px !important; padding: 10px 12px !important; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); text-align: left; cursor: pointer; }
  .decision-options button.active { border-color: var(--review-accent); background: color-mix(in srgb, var(--review-accent) 6%, var(--background-primary)); }
  .decision-options span { font-weight: 800; }
  .decision-options small { color: var(--text-muted); font-size: 10px; }
  .decision-fields { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 10px; margin-top: 12px; }
  .decision-fields label { display: grid; gap: 5px; color: var(--text-muted); font-size: 10px; font-weight: 700; }
  .decision-fields input { width: 100%; min-height: 40px; box-sizing: border-box; color: var(--text-normal); }
  .decision-card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
  .decision-card footer button { height: auto !important; min-height: 38px; padding: 0 14px; border: 1px solid var(--review-line); border-radius: 9px; background: var(--background-primary); font-weight: 700; cursor: pointer; }
  .decision-card footer button.primary { border-color: var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); }
  .empty-main { display: grid; justify-items: center; gap: 8px; min-height: 420px; align-content: center; color: var(--text-muted); text-align: center; }
  .empty-main span { width: 34px; height: 34px; }
  .empty-main h2, .empty-main p { margin: 0; }
  @media (max-width: 1100px) {
    .review-shell { min-width: 680px; padding: 18px; }
    .review-layout { grid-template-columns: 260px minmax(0, 1fr); }
    .review-grid { grid-template-columns: 1fr; }
    .project-title-row { display: grid; }
    .project-actions { flex-wrap: wrap; }
    .project-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .review-shell { min-width: 0; padding: 12px; }
    .review-header { padding: 20px; }
    .review-header-actions .write-state { display: none; }
    .review-layout { display: block; }
    .review-queue { position: static; height: auto; min-height: 0; max-height: none; margin-bottom: 12px; }
    .queue-list { flex: none; max-height: 300px; }
    .review-summary { grid-template-columns: 1fr; }
    .project-facts, .decision-options, .decision-fields, .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  /* Asterism 0.8 review surface: restrained depth, stable columns, no floating fragments. */
  :global(.asterism-project-review-host) {
    --review-surface: color-mix(in srgb, var(--background-secondary) 82%, var(--background-primary));
    --review-surface-raised: color-mix(in srgb, var(--background-secondary-alt) 78%, var(--background-primary));
    --review-shadow: 0 1px 1px rgb(0 0 0 / 3%), 0 9px 26px rgb(0 0 0 / 4%);
  }
  .review-shell {
    width: min(100%, 1880px);
    max-width: 1880px;
    min-width: 0;
    padding: clamp(14px, 1.7vw, 26px);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--review-accent) 5%, var(--background-primary)), transparent 260px),
      var(--background-primary);
  }
  .review-header {
    position: relative;
    min-height: 148px;
    padding: clamp(20px, 2.4vw, 32px);
    overflow: hidden;
    border-color: color-mix(in srgb, var(--review-accent) 22%, var(--review-line));
    border-radius: 21px;
    background:
      radial-gradient(circle at 84% 22%, color-mix(in srgb, var(--review-accent) 15%, transparent) 0 2px, transparent 3px),
      linear-gradient(120deg, color-mix(in srgb, var(--color-blue) 6%, var(--review-surface)), color-mix(in srgb, var(--review-accent) 10%, var(--review-surface)));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 9%);
  }
  .review-header::after {
    position: absolute;
    right: -54px;
    bottom: -112px;
    width: 300px;
    height: 300px;
    border: 1px solid color-mix(in srgb, var(--review-accent) 17%, transparent);
    border-radius: 50%;
    box-shadow: inset 0 0 0 34px color-mix(in srgb, var(--review-accent) 2.5%, transparent);
    content: "";
    pointer-events: none;
  }
  .review-heading, .review-header-actions { position: relative; z-index: 1; }
  .review-heading h1 { margin-top: 12px; font-size: clamp(38px, 4vw, 58px); letter-spacing: -.055em; }
  .review-heading p { max-width: 620px; font-size: 13px; line-height: 1.6; }
  .review-header-actions {
    padding: 4px;
    border: 1px solid var(--review-line);
    border-radius: 13px;
    background: color-mix(in srgb, var(--background-primary) 82%, transparent);
    box-shadow: 0 8px 22px rgb(0 0 0 / 5%);
  }
  .write-state { height: 36px; padding-inline: 10px; border: 0; background: transparent; }
  .icon-button { width: 36px; height: 36px; border-color: transparent; border-radius: 9px; background: transparent; transition: translate 160ms ease, background-color 160ms ease; }
  .icon-button:hover { border-color: var(--review-line); background: var(--review-surface); translate: 0 -1px; }
  .review-summary { gap: 9px; margin: 12px 0; }
  .review-summary > div {
    min-height: 46px;
    padding: 7px 13px;
    border-color: var(--review-line);
    border-radius: 12px;
    background: var(--review-surface);
  }
  .review-summary b { font-size: 18px; }
  .review-layout { grid-template-columns: minmax(260px, 292px) minmax(0, 1fr); gap: 12px; }
  .review-queue, .project-hero, .review-card, .decision-card, .empty-main {
    border-color: var(--review-line);
    border-radius: 15px;
    background: var(--review-surface);
    box-shadow: var(--review-shadow);
  }
  .review-queue {
    top: 12px;
    height: min(720px, calc(100vh - 196px));
    min-height: 460px;
  }
  .queue-heading { padding: 14px 14px 11px; }
  .project-search { margin: 10px; border-radius: 9px; }
  .queue-list { padding: 0 8px 10px; }
  .queue-list > button {
    min-height: 52px !important;
    margin-bottom: 4px;
    padding: 7px 8px !important;
    border-radius: 10px;
    transition: background-color 150ms ease, border-color 150ms ease, translate 150ms ease;
  }
  .queue-list > button:hover { translate: 1px 0; }
  .queue-list strong { font-size: 12px; }
  .queue-list small { margin-top: 2px; }
  .project-hero { padding: clamp(16px, 1.6vw, 22px); }
  .project-title-row { align-items: flex-start; }
  .project-title-row > div:first-child { min-width: 0; }
  .project-title-row h2 {
    display: -webkit-box;
    max-width: 900px;
    margin: 5px 0 9px;
    overflow: hidden;
    font-size: clamp(25px, 2.7vw, 37px);
    line-height: 1.12;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .project-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
  .project-actions button { min-height: 36px; border-color: var(--review-line); background: var(--background-primary); }
  .project-facts { margin-top: 15px; }
  .project-facts div { padding: 10px 11px; }
  .project-facts strong { white-space: normal; overflow-wrap: anywhere; }
  .review-grid { gap: 12px; margin-top: 12px; }
  .review-card { padding: 16px; }
  .review-card > header { margin-bottom: 11px; }
  .project-core dl { gap: 7px; }
  .project-core dl div { padding: 9px 10px; border-radius: 10px; }
  .project-core dd { overflow-wrap: anywhere; }
  .metric-grid { gap: 7px; }
  .metric-grid div { min-height: 70px; border-radius: 10px; }
  .metric-grid strong { font-size: 22px; }
  .evidence-list { gap: 5px; }
  .evidence-list > button { min-height: 49px !important; padding: 8px 9px !important; }
  .evidence-list strong, .evidence-list small { min-width: 0; }
  .decision-card { margin-top: 12px; padding: 18px; }
  .decision-options { margin-top: 13px; }
  .decision-options button { min-height: 54px !important; }
  .decision-card footer { flex-wrap: wrap; }

  @media (max-width: 1120px) {
    .review-shell { min-width: 0; padding: 14px; }
    .review-layout { grid-template-columns: 238px minmax(0, 1fr); }
    .project-title-row { display: grid; }
    .project-actions { justify-content: flex-start; }
    .review-grid { grid-template-columns: 1fr; }
    .project-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .review-shell { padding: 10px; }
    .review-header { min-height: 0; padding: 18px; }
    .review-header-actions { align-self: flex-start; }
    .review-heading h1 { font-size: 38px; }
    .review-layout { display: block; }
    .review-queue { position: static; height: auto; min-height: 0; margin-bottom: 10px; }
    .queue-list { max-height: 280px; }
    .review-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .review-summary > div { grid-template-columns: auto 1fr; gap: 7px; }
    .review-summary small { grid-column: 1 / -1; }
    .project-facts, .decision-options, .decision-fields, .metric-grid { grid-template-columns: 1fr 1fr; }
    .decision-card > header { grid-template-columns: 1fr; display: grid; }
  }
  @media (max-width: 480px) {
    .review-header { display: grid; }
    .review-summary { grid-template-columns: 1fr; }
    .project-facts, .decision-options, .decision-fields, .metric-grid { grid-template-columns: 1fr; }
    .review-header-actions { gap: 8px; }
    .icon-button { width: 44px; height: 44px; }
    .project-actions button { flex: 1; justify-content: center; }
    .project-actions button, .decision-card footer button { min-height: 44px; }
    .decision-card footer button { flex: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .icon-button, .queue-list > button { transition: none; translate: none; }
    .spinning { animation: none; }
  }

  /* 0.8.9: one review decision, one atomic write. */
  .review-header {
    min-height: 0;
    padding: 18px 20px;
  }
  .review-heading h1 {
    margin-top: 8px;
    font-size: clamp(32px, 3.2vw, 44px);
  }
  .project-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .decision-card { padding: 18px; }
  .decision-options {
    min-width: 0;
    padding: 0;
    border: 0;
  }
  .decision-options legend {
    margin-bottom: 7px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .06em;
  }
  .project-update-fields {
    display: grid;
    grid-template-columns: minmax(160px, 210px) minmax(240px, 1fr);
    gap: 10px;
    margin-top: 12px;
  }
  .project-update-fields label,
  .decision-fields label,
  .task-fields label {
    display: grid;
    min-width: 0;
    gap: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
  }
  .project-update-fields input,
  .project-update-fields select,
  .decision-fields input,
  .task-fields input {
    width: 100%;
    min-width: 0;
    min-height: 40px;
    padding-inline: 10px;
    border: 1px solid var(--review-line);
    border-radius: 10px;
    background: var(--background-primary);
    color: var(--text-normal);
    box-sizing: border-box;
  }
  .project-update-fields input:focus,
  .project-update-fields select:focus,
  .decision-fields input:focus,
  .task-fields input:focus {
    border-color: color-mix(in srgb, var(--review-accent) 58%, var(--review-line));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--review-accent) 13%, transparent);
  }
  .decision-fields { grid-template-columns: minmax(170px, 210px) minmax(0, 1fr); }
  .decision-note:only-child { grid-column: 1 / -1; }
  .task-fields {
    display: grid;
    grid-template-columns: minmax(150px, .7fr) minmax(260px, 1.7fr) minmax(150px, .65fr);
    align-items: end;
    gap: 10px;
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--review-line);
    border-radius: 12px;
    background: var(--background-primary);
  }
  .task-fields small { display: block; }
  .task-fields small {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.45;
  }
  .decision-card footer {
    padding-top: 2px;
    border-top: 0;
  }
  .decision-card footer button.primary { min-width: 150px; }
  .task-evidence-item { overflow: hidden; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); }
  .task-evidence-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto auto; align-items: center; gap: 6px; min-height: 52px; padding: 6px; }
  .task-evidence-row button { height: auto !important; box-shadow: none !important; }
  .task-complete, .task-adjust { min-width: 36px; min-height: 36px !important; padding: 0 8px !important; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); }
  .task-complete { display: grid; place-items: center; padding: 0 !important; }
  .task-complete span { width: 17px; height: 17px; }
  .task-complete:hover, .task-adjust:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
  .task-open { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 9px; min-width: 0; min-height: 40px !important; padding: 4px 6px !important; overflow: hidden; border: 0; background: transparent; text-align: left; }
  .task-evidence-row time { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
  .task-evidence-row time.overdue { color: var(--color-red); font-weight: 700; }
  .task-adjust { font-size: 10px; font-weight: 700; }
  .task-quick-editor { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(120px, .7fr) auto; align-items: end; gap: 8px; padding: 10px; border-top: 1px solid var(--review-line); background: color-mix(in srgb, var(--background-secondary) 65%, var(--background-primary)); }
  .task-quick-editor label { display: grid; gap: 5px; min-width: 0; color: var(--text-muted); font-size: 10px; font-weight: 700; }
  .task-quick-editor input, .task-quick-editor select { width: 100%; min-width: 0; min-height: 38px; box-sizing: border-box; }
  .task-save { min-height: 38px !important; padding: 0 12px !important; border: 1px solid var(--interactive-accent); border-radius: 9px; background: var(--interactive-accent); color: var(--text-on-accent); font-size: 11px; font-weight: 700; }

  @media (max-width: 1120px) {
    .project-update-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .next-action-field { grid-column: 1 / -1; }
    .task-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .review-header { gap: 12px; }
    .review-heading h1 { font-size: 34px; }
    .project-update-fields,
    .task-fields { grid-template-columns: 1fr; }
    .next-action-field { grid-column: auto; }
    .decision-card > header { display: block; }
    .task-evidence-row { grid-template-columns: 36px minmax(0, 1fr) auto; }
    .task-evidence-row time { grid-column: 2; }
    .task-adjust { grid-column: 3; grid-row: 1 / span 2; }
    .task-quick-editor { grid-template-columns: 1fr 1fr; }
    .task-save { grid-column: 1 / -1; }
  }
  @media (max-width: 480px) {
    .review-header { display: grid; }
    .project-facts,
    .decision-options,
    .decision-fields { grid-template-columns: 1fr; }
    .decision-note:only-child { grid-column: auto; }
    .decision-card footer button { min-height: 44px; }
        .task-quick-editor { grid-template-columns: 1fr; }
    .task-save { grid-column: auto; min-height: 44px !important; }
  }

  /* Review content follows reading order; controls retain their own typography in host themes. */
  .review-shell :global(strong), .review-shell :global(b) { color: var(--text-normal); }
  .review-main { container-type: inline-size; }
  .review-shell { container-type: inline-size; }
  .review-grid { align-items: start; }
  .task-evidence { grid-column: 1 / -1; }
  .review-card h3, .decision-card h3 { font-size: 18px; line-height: 1.4; }
  .review-card header small, .project-core dt, .metric-grid span, .queue-list small,
  .project-facts small, .decision-options small, .decision-options legend,
  .review-main label, .evidence-list time, .task-adjust { font-size: 12px; }
  .project-core dd, .evidence-list strong, .review-main input, .review-main select,
  .review-main textarea { font-size: 14px; font-weight: 400; line-height: 1.5; }
  .review-main textarea { width: 100%; min-width: 0; resize: vertical; padding: 10px 12px; border: 1px solid var(--review-line); border-radius: 10px; background: var(--background-primary); color: var(--text-normal); box-sizing: border-box; }
  .project-update-fields { grid-template-columns: minmax(150px, 210px) minmax(0, 1fr); }
  .next-action-field { grid-column: auto; }
  .decision-fields { align-items: start; }
  .decision-options span { font-size: 14px; font-weight: 600; }
  .status-change { color: var(--text-muted); font-size: 13px; margin: 12px 0 0; }
  .status-change.conversion { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--review-accent) 34%, var(--review-line)); border-radius: 10px; background: color-mix(in srgb, var(--review-accent) 7%, var(--background-primary)); color: var(--text-normal); }
  .project-type-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 10px 0; }
  .project-type-filters button { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 9px; border: 1px solid var(--review-line); border-radius: 999px; background: var(--background-primary); color: var(--text-muted); cursor: pointer; }
  .project-type-filters button.active { border-color: color-mix(in srgb, var(--review-accent) 55%, var(--review-line)); background: color-mix(in srgb, var(--review-accent) 10%, var(--background-primary)); color: var(--text-normal); }
  .project-type-filters button span { font-size: 11px; font-weight: 700; white-space: nowrap; }
  .project-type-filters button small { min-width: 16px; color: var(--text-muted); font-size: 10px; font-variant-numeric: tabular-nums; text-align: center; }
  .task-evidence-row { grid-template-columns: 36px minmax(0, 1fr) auto auto; }
  .task-open strong { white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
  .task-quick-editor { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
  .task-fields { grid-template-columns: minmax(0, 1fr) 180px; }
  .task-fields small { grid-column: 1 / -1; }
  .review-text-button { margin-top: 12px; margin-right: 12px; min-height: 36px; background: transparent; border: 0; color: var(--text-accent); cursor: pointer; }
  .decision-card footer { align-items: center; flex-wrap: wrap; }
  .decision-card footer small { margin-right: auto; font-size: 12px; color: var(--text-muted); }
  .review-shell :global(:focus-visible) { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }
  @container (max-width: 700px) {
    .project-title-row { display: grid; grid-template-columns: minmax(0, 1fr); }
    .project-title-row h2 { font-size: 24px; white-space: normal; overflow-wrap: anywhere; }
    .project-actions { justify-content: flex-start; }
    .review-summary > div { display: grid; grid-template-columns: auto 1fr; gap: 6px; padding: 10px; }
    .review-summary small { grid-column: 1 / -1; white-space: nowrap; }
    .review-header { flex-wrap: wrap; padding: 18px; gap: 12px; }
    .review-heading { min-width: 0; }
    .review-heading h1 { font-size: 30px; }
    .review-header-actions { flex-wrap: wrap; }
    .review-header-actions .write-state { display: none; }
    .review-layout { grid-template-columns: 1fr; }
    .review-queue { position: static; min-height: 0; height: auto; max-height: 260px; }
    .queue-list { max-height: 160px; }
    .review-grid { grid-template-columns: 1fr; }
    .project-update-fields, .decision-fields, .task-fields { grid-template-columns: 1fr; }
    .task-quick-editor { grid-template-columns: 1fr 1fr; }
    .decision-options { grid-template-columns: 1fr 1fr; }
    .task-evidence-row { grid-template-columns: 36px minmax(0, 1fr) auto; }
    .task-evidence-row time { grid-column: 2; grid-row: 2; }
    .task-adjust { grid-column: 3; grid-row: 1 / span 2; }
  }
</style>
