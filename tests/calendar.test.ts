import { describe, expect, it } from "vitest";
import { buildMonthCalendar, calendarDateLabel, calendarMonthLabel, shiftCalendarMonth } from "../src/domain/calendar";

describe("month calendar", () => {
  it("builds a Monday-aligned six-week grid", () => {
    const cells = buildMonthCalendar("2026-08", "2026-08-29");
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe("2026-07-27");
    expect(cells.at(-1)?.date).toBe("2026-09-06");
    expect(cells.find((cell) => cell.date === "2026-08-29")).toMatchObject({ day: 29, inMonth: true, isToday: true });
  });

  it("moves across year boundaries and formats local labels", () => {
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(calendarMonthLabel("2026-08")).toContain("2026");
    expect(calendarDateLabel("2026-08-29")).toContain("29");
  });
});
