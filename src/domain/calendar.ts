export interface MonthCalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export function buildMonthCalendar(month: string, today: string): MonthCalendarCell[] {
  const { year, monthIndex } = parseMonth(month);
  const first = new Date(year, monthIndex, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const date = localDateKey(value);
    return {
      date,
      day: value.getDate(),
      inMonth: value.getMonth() === monthIndex,
      isToday: date === today
    };
  });
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const { year, monthIndex } = parseMonth(month);
  const value = new Date(year, monthIndex + offset, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function calendarMonthLabel(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(year, monthIndex, 1));
}

export function calendarDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(year, month - 1, day));
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!match) throw new Error(`无效月份：${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error(`无效月份：${month}`);
  return { year, monthIndex };
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
