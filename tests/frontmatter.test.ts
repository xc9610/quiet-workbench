import { describe, expect, it } from "vitest";
import { FrontmatterWriteError, setFrontmatterFields } from "../src/domain/frontmatter-writer";
import { parseFrontmatter } from "../src/domain/markdown";
import { localIsoTimestamp } from "../src/services/knowledge-publishing-service";

describe("parseFrontmatter", () => {
  it("keeps list items separated by blank lines and still ends the list at the next key", () => {
    const parsed = parseFrontmatter("---\ntags:\n  - a\n\n  - b\nstatus: x\n---\n");
    expect(parsed?.fields).toEqual({ tags: ["a", "b"], status: "x" });
  });

  it("reads lists that start after a blank line or at the parent indentation", () => {
    expect(parseFrontmatter("---\ntags:\n\n  - a\n---")?.fields.tags).toEqual(["a"]);
    expect(parseFrontmatter('---\nproject:\n- "[[A]]"\n- "[[B]]"\nstatus: x\n---')?.fields).toEqual({
      project: ["[[A]]", "[[B]]"],
      status: "x"
    });
  });

  it("reads literal and folded block scalars instead of the indicator character", () => {
    const fields = parseFrontmatter("---\nreview_note: |\n  第一行重要结论\n  第二行附加条件\nsummary: >-\n  one\n  two\nstatus: x\n---")?.fields;
    expect(fields?.review_note).toBe("第一行重要结论\n第二行附加条件\n");
    expect(fields?.summary).toBe("one two");
    expect(fields?.status).toBe("x");
  });

  it("joins quoted scalars that continue on indented lines", () => {
    expect(parseFrontmatter('---\ntitle: "abc\n  def"\nnext: 1\n---')?.fields).toEqual({ title: "abc def", next: 1 });
  });
});

describe("setFrontmatterFields", () => {
  it("replaces an indented list value together with all of its items", () => {
    const result = setFrontmatterFields('---\nproject:\n  - "[[A]]"\n  - "[[B]]"\nstatus: 进行中\n---\nbody', { project: "[[P/x]]" });
    expect(result).toBe('---\nproject: "[[P/x]]"\nstatus: 进行中\n---\nbody');
  });

  it("replaces an unindented YAML list value", () => {
    const result = setFrontmatterFields('---\nproject:\n- "[[A]]"\n- "[[B]]"\ntags: [x]\n---\n', { project: "[[P/x]]" });
    expect(result).toBe('---\nproject: "[[P/x]]"\ntags: [x]\n---\n');
  });

  it("replaces block scalars instead of leaving their lines behind", () => {
    const before = "---\nreview_note: |\n  第一行重要结论\n  第二行附加条件\nstatus: x\n---\n";
    const result = setFrontmatterFields(before, { review_note: "新的结论" });
    expect(result).toBe('---\nreview_note: "新的结论"\nstatus: x\n---\n');
  });

  it("keeps blank separator lines and comments that belong to the next key", () => {
    const before = "---\ntags:\n  - a\n\n  - b\n\n# 业务字段\nstatus: x\n---\n";
    const result = setFrontmatterFields(before, { tags: { raw: "[c]" } });
    expect(result).toBe("---\ntags: [c]\n\n# 业务字段\nstatus: x\n---\n");
  });

  it("deletes a field and its continuation lines in delete mode", () => {
    const result = setFrontmatterFields("---\nphase:\n  - 方案\nstatus: x\n---\n", { phase: undefined }, { undefinedFields: "delete" });
    expect(result).toBe("---\nstatus: x\n---\n");
  });

  it("leaves fields untouched for undefined values by default and appends new keys", () => {
    const result = setFrontmatterFields("---\nstatus: x\n---\nbody", { phase: undefined, owner: "me" });
    expect(result).toBe('---\nstatus: x\nowner: "me"\n---\nbody');
  });

  it("does not overwrite existing keys when overwrite is false", () => {
    const result = setFrontmatterFields('---\ntitle: "原标题"\n---\n', { title: "新标题", type: "知识" }, { overwrite: false });
    expect(result).toBe('---\ntitle: "原标题"\ntype: "知识"\n---\n');
  });

  it("writes into an empty frontmatter block instead of the note body", () => {
    const result = setFrontmatterFields("---\n---\n正文\n\n---\n分隔线之后", { status: "x" });
    expect(result).toBe('---\nstatus: "x"\n---\n正文\n\n---\n分隔线之后');
  });

  it("preserves CRLF line endings and a byte order mark", () => {
    const result = setFrontmatterFields("\uFEFF---\r\nstatus: a\r\ntags:\r\n  - x\r\n---\r\nbody\r\n", { status: "b" });
    expect(result).toBe('\uFEFF---\r\nstatus: "b"\r\ntags:\r\n  - x\r\n---\r\nbody\r\n');
  });

  it("does not confuse keys that share a prefix", () => {
    const result = setFrontmatterFields('---\nproject_type: 售前\nproject: "[[A]]"\n---\n', { project: "[[B]]" });
    expect(result).toBe('---\nproject_type: 售前\nproject: "[[B]]"\n---\n');
  });

  it("refuses or creates frontmatter for plain notes depending on the option", () => {
    expect(() => setFrontmatterFields("正文", { status: "x" }, { missing: { error: "缺少 frontmatter" } })).toThrow("缺少 frontmatter");
    expect(setFrontmatterFields("\n正文", { status: "x" }, { missing: "create" })).toBe('---\nstatus: "x"\n---\n正文');
  });

  it("rejects invalid keys and raw values with newlines", () => {
    expect(() => setFrontmatterFields("---\n---\n", { "bad key": "x" })).toThrow(FrontmatterWriteError);
    expect(() => setFrontmatterFields("---\n---\n", { ok: { raw: "a\nb: c" } })).toThrow(FrontmatterWriteError);
  });

  it("produces frontmatter whose untouched fields parse identically", () => {
    const before = '---\naliases:\n  - 示例\nproject:\n- "[[A]]"\nnote: |\n  多行\n  内容\nstatus: 进行中\n---\n# 标题';
    const after = setFrontmatterFields(before, { project: "[[B]]", updated: "2026-10-06" });
    const previous = parseFrontmatter(before)?.fields ?? {};
    const next = parseFrontmatter(after)?.fields ?? {};
    expect(next.aliases).toEqual(previous.aliases);
    expect(next.note).toEqual(previous.note);
    expect(next.status).toEqual(previous.status);
    expect(next.project).toBe("[[B]]");
    expect(after.endsWith("---\n# 标题")).toBe(true);
  });
});

describe("localIsoTimestamp", () => {
  it("keeps the local date and states the offset explicitly", () => {
    const date = new Date(2026, 9, 6, 0, 30, 5);
    const stamp = localIsoTimestamp(date);
    expect(stamp.startsWith("2026-10-06T00:30:05")).toBe(true);
    expect(stamp).toMatch(/[+-]\d{2}:\d{2}$/u);
  });
});
