import { describe, expect, it } from "vitest";
import { renderNoteMarkdown } from "../src/domain/note";
import { filterSearchableOptions } from "../src/ui/searchable-select";

describe("workbench note form", () => {
  it("renders a traceable note with optional project and client links", () => {
    const content = renderNoteMarkdown({
      title: "热控方案讨论",
      body: "记录主要结论。",
      relatedClient: "10_业务_Business/01_客户_Clients/客户甲.md",
      relatedProject: "10_业务_Business/02_项目_Projects/项目甲.md"
    }, "2026-09-08");

    expect(content).toContain("created: 2026-09-08");
    expect(content).toContain('client: "[[10_业务_Business/01_客户_Clients/客户甲]]"');
    expect(content).toContain('project: "[[10_业务_Business/02_项目_Projects/项目甲]]"');
    expect(content).toContain("# 热控方案讨论\n\n记录主要结论。");
  });

  it("filters relation candidates by labels, metadata, paths and Unicode-normalized text", () => {
    const options = [
      { value: "projects/a.md", label: "项目Ａ", description: "推进中", keywords: ["客户甲"] },
      { value: "projects/b.md", label: "项目乙", description: "暂停" }
    ];

    expect(filterSearchableOptions(options, "项目A").map((option) => option.value)).toEqual(["projects/a.md"]);
    expect(filterSearchableOptions(options, "客户甲").map((option) => option.value)).toEqual(["projects/a.md"]);
    expect(filterSearchableOptions(options, "暂停").map((option) => option.value)).toEqual(["projects/b.md"]);
  });
});
