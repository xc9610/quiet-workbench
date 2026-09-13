import { describe, expect, it } from "vitest";
import { projectStatusLabel, isClosedProjectStatus } from "../src/domain/project-status";
import { buildProjectReviewEvidence, projectReviewTriggers, reviewTaskTitle } from "../src/domain/project-review";
import { isPreSalesProject, matchesProjectType, normalizeProjectType, projectFolderForType } from "../src/domain/project-type";

describe("project workflow presentation", () => {
  it("normalizes legacy project types and routes new projects to canonical folders", () => {
    expect(normalizeProjectType("售前项目")).toBe("售前方案");
    expect(normalizeProjectType("研发项目")).toBe("内部研发");
    expect(isPreSalesProject("售前项目")).toBe(true);
    expect(matchesProjectType("售前项目", "售前方案")).toBe(true);
    expect(matchesProjectType("合同交付", "售前方案")).toBe(false);
    expect(projectFolderForType("10_业务_Business/02_项目_Projects", "合同交付"))
      .toBe("10_业务_Business/02_项目_Projects/合同交付");
    expect(projectFolderForType("10_业务_Business/02_项目_Projects/售前方案", "合同交付"))
      .toBe("10_业务_Business/02_项目_Projects/合同交付");
  });
  it("requires an explicit project relation rather than a shared name fragment", () => {
    const evidence = buildProjectReviewEvidence(
      { kind: "project", name: "热控", path: "projects/热控.md" }, [],
      [{ kind: "meeting", name: "热控工艺会议", path: "meetings/工艺.md" },
       { kind: "meeting", name: "评审", path: "meetings/评审.md", project: "[[projects/热控|热控项目]]" }],
      "2026-09-09");
    expect(evidence.meetings.map((meeting) => meeting.name)).toEqual(["评审"]);
  });
  it("groups legacy active states without confusing phase with status", () => {
    for (const status of ["推进中", "进行中", "跟进中", "进"]) expect(projectStatusLabel(status)).toBe("推进中");
    expect(projectStatusLabel("立项")).toBe("立项");
    expect(projectStatusLabel()).toBe("未设置");
  });
  it("recognizes the status actually written by the stop decision", () => {
    for (const status of ["归档", "已归档", "停止", "已完成"]) expect(isClosedProjectStatus(status)).toBe(true);
    expect(projectReviewTriggers({ kind: "project", name: "测试", path: "test.md", status: "归档" }, "2026-09-09")).toEqual([]);
  });
  it("cleans display noise without dropping linked task subject names", () => {
    expect(reviewTaskTitle("完成方案 [[热控项目]] #任务/方案资料", "热控项目")).toBe("完成方案");
    expect(reviewTaskTitle("核对 [[资料/边界条件|热边界]] #任务/测试", "热控项目")).toBe("核对 热边界");
    expect(reviewTaskTitle("#任务/测试", "热控项目")).toBe("#任务/测试");
  });
});
