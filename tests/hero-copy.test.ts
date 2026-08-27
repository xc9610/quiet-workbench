import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_SETTINGS,
  parseHeroCopyLines,
  selectHeroCopy,
  serializeHeroCopies
} from "../src/core/hero-copy";

const emptyContext = { overdue: 0, dueToday: 0, upcoming: 0, missingNext: 0 };

describe("hero copy", () => {
  it("keeps the daily copy stable for the same local date", () => {
    expect(selectHeroCopy(DEFAULT_HERO_SETTINGS, "2026-08-27", emptyContext))
      .toEqual(selectHeroCopy(DEFAULT_HERO_SETTINGS, "2026-08-27", emptyContext));
  });

  it("rotates built-in daily copy across a date range", () => {
    const titles = new Set(Array.from({ length: 12 }, (_, index) =>
      selectHeroCopy(DEFAULT_HERO_SETTINGS, `2026-09-${String(index + 1).padStart(2, "0")}`, emptyContext).title
    ));
    expect(titles.size).toBeGreaterThan(1);
  });

  it("uses contextual copy only in contextual mode", () => {
    const result = selectHeroCopy({ mode: "contextual", customCopies: [] }, "2026-08-27", { ...emptyContext, overdue: 3 });
    expect(result.title).toBe("先收拢，再出发");
    expect(result.subtitle).toContain("逾期");
  });

  it("rotates valid custom copy and ignores incomplete lines", () => {
    const copies = parseHeroCopyLines("第一句｜第一条说明\n无效行\n第二句 | 第二条说明");
    expect(copies).toEqual([
      { title: "第一句", subtitle: "第一条说明" },
      { title: "第二句", subtitle: "第二条说明" }
    ]);
    expect(serializeHeroCopies(copies)).toBe("第一句｜第一条说明\n第二句｜第二条说明");
    expect(["第一句", "第二句"]).toContain(selectHeroCopy({ mode: "custom", customCopies: copies }, "2026-08-27", emptyContext).title);
  });

  it("falls back to built-in copy when the custom library is empty", () => {
    const result = selectHeroCopy({ mode: "custom", customCopies: [] }, "2026-08-27", emptyContext);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.subtitle.length).toBeGreaterThan(0);
  });
});
