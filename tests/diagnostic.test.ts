import { describe, expect, it, vi } from "vitest";
import { DiagnosticService, frontmatterKeys, type DiagnosticVaultReader } from "../src/core/diagnostic";
import { DEFAULT_SETTINGS } from "../src/settings";

function reader(overrides: Partial<DiagnosticVaultReader> = {}): DiagnosticVaultReader {
  return {
    exists: vi.fn(async () => true),
    read: vi.fn(async () => "---\norganization_type: company\nstage: active\n---\nBody"),
    listMarkdownFiles: vi.fn(async () => ["clients/Acme.md"]),
    pluginEnabled: vi.fn((id) => id === "dataview"),
    ...overrides
  };
}

describe("DiagnosticService", () => {
  it("checks folders, templates, aliases and optional plugins through a read-only port", async () => {
    const adapter = reader();
    const report = await new DiagnosticService(adapter).run(DEFAULT_SETTINGS);
    expect(report.readOnly).toBe(true);
    expect(report.items.filter((item) => item.category === "folder")).toHaveLength(5);
    expect(report.items.filter((item) => item.category === "template")).toHaveLength(4);
    expect(report.items.filter((item) => item.category === "optional-plugin")).toHaveLength(4);
    expect(report.items.find((item) => item.id === "alias.organization_type")?.status).toBe("pass");
    expect(report.items.find((item) => item.id === "alias.relationship_status")?.status).toBe("info");
    expect(report.items.find((item) => item.id === "plugin.obsidian-tasks-plugin")?.detail).toContain("核心功能仍可运行");
    expect(adapter.read).toHaveBeenCalledTimes(1);
  });

  it("warns instead of attempting repairs when paths are missing", async () => {
    const adapter = reader({
      exists: vi.fn(async (path) => !path.includes("Clients"))
    });
    const report = await new DiagnosticService(adapter).run(DEFAULT_SETTINGS);
    expect(report.items.find((item) => item.id === "folder.client")?.status).toBe("warn");
    expect(report.items.find((item) => item.id === "aliases.client")?.detail).toContain("无法检查");
    expect(adapter.listMarkdownFiles).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("limits alias scanning to 50 client files", async () => {
    const paths = Array.from({ length: 75 }, (_, index) => `clients/${index}.md`);
    const adapter = reader({ listMarkdownFiles: vi.fn(async () => paths) });
    await new DiagnosticService(adapter).run(DEFAULT_SETTINGS);
    expect(adapter.read).toHaveBeenCalledTimes(50);
  });

  it("finishes the report when one client file cannot be read", async () => {
    const adapter = reader({
      listMarkdownFiles: vi.fn(async () => ["clients/good.md", "clients/bad.md"]),
      read: vi.fn(async (path) => {
        if (path.endsWith("bad.md")) throw new Error("unreadable");
        return "---\norganization_type: company\n---\n";
      })
    });
    const report = await new DiagnosticService(adapter).run(DEFAULT_SETTINGS);
    expect(report.items.find((item) => item.id === "aliases.client.read-errors")?.status).toBe("warn");
    expect(report.items.find((item) => item.id === "alias.organization_type")?.status).toBe("pass");
  });
});

describe("frontmatterKeys", () => {
  it("reads top-level keys only from a leading frontmatter block", () => {
    expect([...frontmatterKeys("---\nname: Acme\ntags:\n  - client\n---\nstatus: body")]).toEqual(["name", "tags"]);
    expect(frontmatterKeys("Body\n---\nname: no\n---").size).toBe(0);
  });
});
