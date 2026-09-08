import type { LayoutItem } from "./types";

export type SceneId = string;

interface LegacySceneDefinition {
  id: SceneId;
  items: LayoutItem[];
}

/**
 * Compatibility layouts retained for vaults created before the single-page
 * workbench. New installs use the saved "workbench" layout instead.
 */
const LEGACY_SCENES: readonly LegacySceneDefinition[] = [
  {
    id: "today",
    items: [
      { widgetId: "tasks.today", x: 0, y: 0, width: 8, height: 7 },
      { widgetId: "capture.memo", x: 8, y: 0, width: 4, height: 3 },
      { widgetId: "core.quick-create", x: 8, y: 3, width: 4, height: 2 },
      { widgetId: "projects.recent", x: 8, y: 5, width: 4, height: 3 }
    ]
  },
  {
    id: "projects",
    items: [
      { widgetId: "projects.status", x: 0, y: 0, width: 4, height: 4 },
      { widgetId: "projects.milestones", x: 4, y: 0, width: 4, height: 4 },
      { widgetId: "tasks.project", x: 8, y: 0, width: 4, height: 4 },
      { widgetId: "clients.list", x: 0, y: 4, width: 6, height: 4 },
      { widgetId: "suppliers.list", x: 6, y: 4, width: 6, height: 4 },
      { widgetId: "meetings.actions", x: 0, y: 8, width: 12, height: 4 }
    ]
  },
  {
    id: "knowledge",
    items: [
      { widgetId: "knowledge.inbox", x: 0, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.triage", x: 4, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.project-links", x: 8, y: 0, width: 4, height: 4 },
      { widgetId: "knowledge.recent", x: 0, y: 4, width: 12, height: 4 }
    ]
  }
];

export function legacySceneItems(sceneId: SceneId): LayoutItem[] {
  return LEGACY_SCENES.find((scene) => scene.id === sceneId)?.items ?? [];
}
