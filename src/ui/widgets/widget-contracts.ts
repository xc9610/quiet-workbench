import type { WorkbenchSnapshot } from "../controller";
import type { CalendarAgendaGroup } from "../../domain/calendar-entries";

export type ProjectEntity = WorkbenchSnapshot["projects"][number];
export type ClientEntity = WorkbenchSnapshot["clients"][number];
export type MeetingEntity = WorkbenchSnapshot["meetings"][number];
export type SupplierEntity = WorkbenchSnapshot["suppliers"][number];

export type MemoRecentEntry = { time?: string; text: string; date: string };

export type SummaryField = { label: string; value: string };

export type SummaryAnimalOption = { id: string; emoji: string; label: string };

export type SummaryAnimal = {
  value: string;
  options: ReadonlyArray<SummaryAnimalOption>;
};

/** Presentation-ready project, client, meeting or supplier summary. */
export type SummaryModel = {
  path: string;
  iconKind: "project" | "client" | "meeting" | "supplier";
  iconText: string;
  name: string;
  subtitle: string;
  badge: string;
  fields: SummaryField[];
  noteLabel?: string;
  noteText?: string;
  shareLabel: string;
  sharedLabel?: string;
  shared: boolean;
  openLabel: string;
  animal?: SummaryAnimal | null;
};

export type AgendaGroup = CalendarAgendaGroup & { label?: string };

export type DayTask = { path: string; due?: string; text: string };

export type SummaryRenderModel = {
  model: SummaryModel | null;
  emptyMessage: string;
  onShare: () => void;
  onAnimalChange: (value: string) => void;
};
