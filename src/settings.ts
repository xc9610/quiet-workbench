import type { LayoutSchema } from "./core/types";

export interface QuietWorkbenchSettings {
  writesEnabled: boolean;
  projectFolder: string;
  clientFolder: string;
  meetingFolder: string;
  supplierFolder: string;
  knowledgeFolder: string;
  formalKnowledgeFolder: string;
  knowledgeTemplate: string;
  memoPath: string;
  templates: Record<"project" | "client" | "meeting" | "supplier", string>;
  clientAliases: Record<string, string[]>;
  enabledPacks: Record<string, boolean>;
  activeWorkbenchLayout: string;
  activeSidebarLayout: string;
  layouts: LayoutSchema[];
  transactionLimit: number;
}

export const DEFAULT_SETTINGS: QuietWorkbenchSettings = {
  writesEnabled: false,
  projectFolder: "10_业务_Business/02_项目_Projects",
  clientFolder: "10_业务_Business/01_客户_Clients",
  meetingFolder: "10_业务_Business/03_会议_Meetings",
  supplierFolder: "10_业务_Business/08_供应商_Suppliers",
  knowledgeFolder: "20_技术_Technology",
  formalKnowledgeFolder: "20_技术_Technology/90_待整理_Inbox",
  knowledgeTemplate: "",
  memoPath: "40_管理_Management/01_工作_Work/Quiet Workbench 速记.md",
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
  activeWorkbenchLayout: "workbench",
  activeSidebarLayout: "sidebar-default",
  layouts: [],
  transactionLimit: 50
};
