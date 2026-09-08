import { App, type MarkdownPostProcessorContext, setIcon, TFile } from "obsidian";
import { matchProjectFiles, type ProjectFileMatch, type ProjectFileMatchReason } from "../domain/project-files";

const PROJECT_ASSET_ROOT = "60_附件_Assets/项目资料库";

export function enhanceProjectTimeline(el: HTMLElement, context: MarkdownPostProcessorContext): void {
  const entityType = frontmatterEntityType(context.frontmatter);
  const headingLabel = entityType === "project"
    ? "推进记录"
    : entityType === "client" || entityType === "supplier"
      ? "动态记录"
      : "";
  if (!headingLabel) return;

  for (const heading of el.querySelectorAll<HTMLHeadingElement>("h2")) {
    if (heading.textContent?.trim() !== headingLabel) continue;
    let sibling = heading.nextElementSibling;
    while (sibling && !/^H[1-6]$/.test(sibling.tagName)) {
      if (sibling.instanceOf(HTMLUListElement)) {
        sibling.classList.add(entityType === "project" ? "asterism-project-timeline" : `asterism-${entityType}-timeline`);
      }
      sibling = sibling.nextElementSibling;
    }
  }
}

export function renderProjectRelatedFiles(
  app: App,
  source: string,
  el: HTMLElement,
  context: MarkdownPostProcessorContext
): void {
  el.empty();
  const entityType = frontmatterEntityType(context.frontmatter);
  if (entityType !== "project") {
    el.createEl("p", { cls: "asterism-related-files-empty", text: "此资料块只能用于项目笔记。" });
    return;
  }

  const entityFile = app.vault.getAbstractFileByPath(context.sourcePath);
  if (!(entityFile instanceof TFile)) return;
  const cache = app.metadataCache.getFileCache(entityFile);
  const linkedPaths = [...(cache?.links ?? []), ...(cache?.embeds ?? [])]
    .map((link) => app.metadataCache.getFirstLinkpathDest(link.link, context.sourcePath)?.path)
    .filter((path): path is string => Boolean(path));
  const aliases = frontmatterStrings((context.frontmatter as Record<string, unknown> | undefined)?.aliases);
  const matches = matchProjectFiles({
    projectName: entityFile.basename,
    aliases,
    linkedPaths,
    assetRoot: PROJECT_ASSET_ROOT,
    files: app.vault.getFiles().map((file) => ({
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      modifiedAt: file.stat.mtime
    }))
  });
  const limit = parseLimit(source);
  const container = el.createDiv({ cls: "asterism-related-files" });
  const header = container.createDiv({ cls: "asterism-related-files-header" });
  header.createEl("strong", { text: "自动关联资料" });
  header.createSpan({ text: `${matches.length} 项` });

  if (matches.length === 0) {
    container.createEl("p", {
      cls: "asterism-related-files-empty",
      text: "尚未发现资料。将附件链接到本页，或放入与项目同名的资料文件夹后会自动显示。"
    });
    return;
  }

  const list = container.createDiv({ cls: "asterism-related-files-list" });
  for (const match of matches.slice(0, limit)) renderFileButton(app, list, match, context.sourcePath);
  if (matches.length > limit) {
    container.createEl("small", { cls: "asterism-related-files-more", text: `另有 ${matches.length - limit} 项，请缩小项目资料范围或增加显示上限。` });
  }
}

function renderFileButton(app: App, parent: HTMLElement, match: ProjectFileMatch, sourcePath: string): void {
  const button = parent.createEl("button", { cls: "asterism-related-file" });
  button.type = "button";
  button.setAttribute("aria-label", `打开资料：${match.basename}`);
  const icon = button.createSpan({ cls: "asterism-related-file-icon" });
  setIcon(icon, fileIcon(match.extension));
  const copy = button.createSpan({ cls: "asterism-related-file-copy" });
  copy.createEl("strong", { text: match.basename });
  copy.createEl("small", { text: `${match.extension.toLocaleUpperCase("en-US")} · ${reasonLabel(match.reason)}` });
  button.createSpan({ cls: "asterism-related-file-open", text: "打开" });
  button.addEventListener("click", () => void app.workspace.openLinkText(match.path, sourcePath, false));
}

function frontmatterEntityType(frontmatter: unknown): "project" | "client" | "supplier" | undefined {
  if (!frontmatter || typeof frontmatter !== "object") return undefined;
  const type = (frontmatter as Record<string, unknown>).type;
  const values = Array.isArray(type) ? type : [type];
  if (values.some((entry) => typeof entry === "string" && entry.includes("项目"))) return "project";
  if (values.some((entry) => typeof entry === "string" && entry.includes("客户"))) return "client";
  if (values.some((entry) => typeof entry === "string" && entry.includes("供应商"))) return "supplier";
  return undefined;
}

function frontmatterStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function parseLimit(source: string): number {
  const value = Number(source.match(/(?:^|\n)\s*limit\s*:\s*(\d+)/i)?.[1] ?? 8);
  return Number.isFinite(value) ? Math.min(20, Math.max(1, Math.round(value))) : 8;
}

function reasonLabel(reason: ProjectFileMatchReason): string {
  if (reason === "linked") return "本页已链接";
  if (reason === "folder") return "项目资料夹";
  return "项目名称匹配";
}

function fileIcon(extension: string): string {
  const normalized = extension.toLocaleLowerCase("en-US");
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(normalized)) return "image";
  if (["xls", "xlsx", "csv"].includes(normalized)) return "sheet";
  if (["ppt", "pptx", "key"].includes(normalized)) return "presentation";
  if (["zip", "rar", "7z", "tar", "gz"].includes(normalized)) return "archive";
  if (["pdf", "doc", "docx", "pages", "txt"].includes(normalized)) return "file-text";
  return "paperclip";
}
