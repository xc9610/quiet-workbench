import { describe, expect, it } from "vitest";
import { matchProjectFiles, normalizeProjectFileKey } from "../src/domain/project-files";

describe("project file matching", () => {
  it("normalizes wikilinks, punctuation and extensions", () => {
    expect(normalizeProjectFileKey("[[售前方案/东方天算 服务器改造|服务器改造.pdf]]")).toBe("东方天算服务器改造");
  });

  it("prioritizes explicit links before project folders and filenames", () => {
    const result = matchProjectFiles({
      projectName: "东方天算 服务器改造",
      aliases: ["天算服务器改造"],
      linkedPaths: ["60_附件_Assets/其他/客户需求.docx"],
      files: [
        { path: "60_附件_Assets/其他/客户需求.docx", basename: "客户需求", extension: "docx", modifiedAt: 1 },
        { path: "60_附件_Assets/项目资料库/东方天算 服务器改造/接口清单.xlsx", basename: "接口清单", extension: "xlsx", modifiedAt: 2 },
        { path: "60_附件_Assets/项目资料库/散件/东方天算 服务器改造报价.pdf", basename: "东方天算 服务器改造报价", extension: "pdf", modifiedAt: 3 }
      ]
    });

    expect(result.map((file) => [file.basename, file.reason])).toEqual([
      ["客户需求", "linked"],
      ["接口清单", "folder"],
      ["东方天算 服务器改造报价", "filename"]
    ]);
  });

  it("does not guess unrelated or Markdown files", () => {
    const result = matchProjectFiles({
      projectName: "MN200S-2 平台热设计",
      aliases: ["MN"],
      files: [
        { path: "60_附件_Assets/项目资料库/其他项目/MN产品介绍.pdf", basename: "MN产品介绍", extension: "pdf" },
        { path: "60_附件_Assets/项目资料库/MN200S-2 平台热设计/项目索引.md", basename: "项目索引", extension: "md" },
        { path: "50_资料_References/MN200S-2 平台热设计.md", basename: "MN200S-2 平台热设计", extension: "md" }
      ]
    });

    expect(result).toEqual([]);
  });

});
