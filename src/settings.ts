import type { LayoutSchema, SidebarProfileId } from "./core/types";
import { DEFAULT_HERO_SETTINGS, type HeroCopySettings } from "./core/hero-copy";
import { DEFAULT_SIDEBAR_PROFILES } from "./core/sidebar-context";

export type AppearanceMode = "clear" | "journal";

export interface QuietWorkbenchSettings {
  writesEnabled: boolean;
  openWorkbenchOnStartup: boolean;
  appearanceMode: AppearanceMode;
  companionName: string;
  workspaceLabel: string;
  heroBackgroundMode: "animal" | "classic";
  projectAnimals: Record<string, string>;
  projectFolder: string;
  clientFolder: string;
  meetingFolder: string;
  supplierFolder: string;
  solutionAssetsFolder: string;
  knowledgeFolder: string;
  formalKnowledgeFolder: string;
  knowledgeTemplate: string;
  memoPath: string;
  templates: Record<"project" | "client" | "meeting" | "supplier", string>;
  clientAliases: Record<string, string[]>;
  enabledPacks: Record<string, boolean>;
  hero: HeroCopySettings;
  activeWorkbenchLayout: string;
  activeSidebarLayout: string;
  sidebarProfiles: Record<SidebarProfileId, string>;
  layouts: LayoutSchema[];
  /** Layout engine marker and reversible snapshot from before ordered-grid migration. */
  orderedGridVersion: number;
  legacyPositionedLayouts: LayoutSchema[];
  transactionLimit: number;
  /** Full Calendar public API access token. Stored in local plugin settings, never in Markdown. */
  fullCalendarAccessToken: string;
}

export function defaultCompanionForVault(vaultName: string): { name: string; label: string; title: string; subtitle: string } | undefined {
  if (vaultName === "Asterism") {
    return { name: "卡皮", label: "工作库", title: "卡皮在这儿", subtitle: "先看清下一步，再把分散的信息带回项目。" };
  }
  if (vaultName === "Obsidian") {
    return { name: "慢慢", label: "私人库", title: "慢慢来，看看今天", subtitle: "日记、健康和生活，按自己的节奏整理。" };
  }
  return undefined;
}

export const DEFAULT_SETTINGS: QuietWorkbenchSettings = {
  writesEnabled: false,
  openWorkbenchOnStartup: true,
  appearanceMode: "clear",
  companionName: "",
  workspaceLabel: "",
  heroBackgroundMode: "animal",
  projectAnimals: {},
  projectFolder: "10_业务_Business/02_项目_Projects",
  clientFolder: "10_业务_Business/01_客户_Clients",
  meetingFolder: "10_业务_Business/03_会议_Meetings",
  supplierFolder: "10_业务_Business/08_供应商_Suppliers",
  solutionAssetsFolder: "10_业务_Business/04_方案资产_SolutionAssets",
  knowledgeFolder: "20_技术_Technology",
  formalKnowledgeFolder: "20_技术_Technology/90_待整理_Inbox",
  knowledgeTemplate: "",
  memoPath: "40_管理_Management/01_工作_Work/Asterism 速记.md",
  templates: {
    project: "40_管理_Management/03_模板_Templates/TP 项目记录 v3.md",
    client: "40_管理_Management/03_模板_Templates/TP 客户记录 v2.md",
    meeting: "40_管理_Management/03_模板_Templates/TP 会议纪要 v2.md",
    supplier: "40_管理_Management/03_模板_Templates/TP 供应商记录 v1.md"
  },
  clientAliases: {
    organization_type: ["company_type"],
    business_domains: ["business_type"],
    relationship_status: ["stage"],
    followup_date: ["next_followup"]
  },
  enabledPacks: {
    projects: true,
    clients: true,
    suppliers: true,
    meetings: true,
    tasks: true,
    knowledge: true
  },
  hero: structuredClone(DEFAULT_HERO_SETTINGS),
  activeWorkbenchLayout: "workbench",
  activeSidebarLayout: "sidebar-default",
  sidebarProfiles: { ...DEFAULT_SIDEBAR_PROFILES },
  layouts: [],
  orderedGridVersion: 0,
  legacyPositionedLayouts: [],
  transactionLimit: 50,
  fullCalendarAccessToken: ""
};
