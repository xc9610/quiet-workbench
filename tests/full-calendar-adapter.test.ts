import { describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "../src/core/types";
import { FullCalendarAdapter } from "../src/services/full-calendar-adapter";

const task: TaskRecord = {
  id: "project.md:12",
  scope: "project",
  path: "10_业务_Business/02_项目_Projects/演示.md",
  line: 12,
  text: "确认下一步",
  completed: false,
  due: "2026-09-05",
  sourceName: "演示",
  revision: "r1"
};

describe("FullCalendarAdapter", () => {
  it("reports an unavailable optional integration without prompting", async () => {
    const adapter = new FullCalendarAdapter({
      resolvePlugin: () => undefined,
      getToken: () => "",
      saveToken: vi.fn(async () => undefined)
    });

    await expect(adapter.snapshot(new Date(2026, 7, 1), new Date(2026, 8, 1))).resolves.toMatchObject({
      state: "unavailable",
      available: false,
      events: []
    });
  });

  it("authorizes once and schedules the zero-based Tasks line using scheduledDate", async () => {
    let token = "";
    const scheduleTask = vi.fn(async (_taskId: string, _date: Date, _allDay?: boolean) => undefined);
    const requestAccess = vi.fn(async () => "calendar-token");
    const api = {
      requestAccess,
      withToken: () => ({
        getEvents: vi.fn(async () => []),
        getSettings: vi.fn(async () => ({
          tasks: {
            backlogDateTarget: "scheduledDate",
            calendarDisplayDateTarget: "scheduledDate"
          }
        })),
        openCalendar: vi.fn(async () => undefined),
        validateTaskSchedule: vi.fn(async () => ({ valid: true })),
        scheduleTask
      })
    };
    const adapter = new FullCalendarAdapter({
      resolvePlugin: () => ({ api }),
      getToken: () => token,
      saveToken: vi.fn(async (value: string) => { token = value; })
    });

    await adapter.scheduleTask(task, "2026-09-02");

    expect(requestAccess).toHaveBeenCalledWith(
      "quiet-workbench",
      expect.any(String),
      expect.arrayContaining(["events:write", "settings:read"])
    );
    expect(scheduleTask).toHaveBeenCalledWith(
      "10_业务_Business/02_项目_Projects/演示.md::11",
      expect.any(Date),
      true
    );
    const planned = scheduleTask.mock.calls[0]?.[1];
    expect(planned?.getFullYear()).toBe(2026);
    expect(planned?.getMonth()).toBe(8);
    expect(planned?.getDate()).toBe(2);
  });

  it("refuses a dueDate mapping so scheduling cannot silently move a deadline", async () => {
    const scheduleTask = vi.fn(async (_taskId: string, _date: Date, _allDay?: boolean) => undefined);
    const api = {
      requestAccess: vi.fn(async () => "unused"),
      withToken: () => ({
        getEvents: vi.fn(async () => []),
        getSettings: vi.fn(async () => ({
          tasks: {
            backlogDateTarget: "dueDate",
            calendarDisplayDateTarget: "dueDate"
          }
        })),
        openCalendar: vi.fn(async () => undefined),
        scheduleTask
      })
    };
    const adapter = new FullCalendarAdapter({
      resolvePlugin: () => ({ api }),
      getToken: () => "existing-token",
      saveToken: vi.fn(async () => undefined)
    });

    await expect(adapter.scheduleTask(task, "2026-09-02")).rejects.toThrow("计划日期");
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it("normalizes external calendar events and keeps Tasks entries identifiable", async () => {
    const api = {
      requestAccess: vi.fn(async () => "unused"),
      withToken: () => ({
        getEvents: vi.fn(async () => [
          {
            id: "event-1",
            title: "客户评审",
            date: "2026-09-02",
            startTime: "10:00",
            endTime: "11:00",
            calendarName: "工作",
            allDay: false,
            isTask: false,
            isCompleted: false
          },
          {
            id: "task-1",
            title: "准备材料",
            date: "2026-09-02",
            allDay: true,
            isTask: true,
            isCompleted: true
          }
        ]),
        getSettings: vi.fn(async () => ({})),
        openCalendar: vi.fn(async () => undefined),
        scheduleTask: vi.fn(async () => undefined)
      })
    };
    const adapter = new FullCalendarAdapter({
      resolvePlugin: () => ({ api }),
      getToken: () => "existing-token",
      saveToken: vi.fn(async () => undefined)
    });

    const snapshot = await adapter.snapshot(new Date(2026, 8, 1), new Date(2026, 8, 30));

    expect(snapshot.state).toBe("ready");
    expect(snapshot.events).toEqual([
      expect.objectContaining({ id: "event-1", calendarName: "工作", startTime: "10:00", isTask: false }),
      expect.objectContaining({ id: "task-1", completed: true, isTask: true })
    ]);
  });
});
