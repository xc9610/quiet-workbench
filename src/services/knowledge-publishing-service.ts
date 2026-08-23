import { contentRevision, normalizeNewlines, parseFrontmatter, stableHash } from "../domain/markdown";
import type { TransactionPlan } from "../domain/transactions";
import { TemplateService } from "./template-service";
import { normalizeVaultPath, type VaultPort } from "./vault-port";

const CONTENT_MARKER = "<!-- quiet-workbench:content -->";
const DEFAULT_SOURCE_STATUS = "已归档";

export interface KnowledgePublicationInput {
  sourcePath: string;
  title: string;
  targetFolder: string;
  templatePath?: string;
  projectPath?: string;
  sourceStatus?: "待处理" | "待沉淀" | "待读" | "已归档" | "重复";
  now?: Date;
}

export interface KnowledgePublicationPreview {
  id: string;
  sourcePath: string;
  targetPath: string;
  templatePath?: string;
  projectPath?: string;
  sourceBefore: string;
  sourceAfter: string;
  targetContent: string;
  plan: TransactionPlan;
}

export class KnowledgePublicationConflictError extends Error {
  constructor(public readonly path: string) {
    super(`Knowledge target already exists: ${path}`);
    this.name = "KnowledgePublicationConflictError";
  }
}

export class KnowledgeSourceAlreadyPublishedError extends Error {
  constructor(public readonly sourcePath: string, public readonly target: string) {
    super(`Knowledge source was already published to ${target}: ${sourcePath}`);
    this.name = "KnowledgeSourceAlreadyPublishedError";
  }
}

/**
 * Builds a reviewable, conflict-aware transaction plan for promoting an inbox
 * note into a formal knowledge note. It never evaluates template code and never
 * includes the template itself in the transaction operations.
 */
export class KnowledgePublicationPlanner {
  constructor(
    private readonly vault: VaultPort,
    private readonly templates = new TemplateService(),
    private readonly idFactory: (sourcePath: string, targetPath: string, now: Date) => string = defaultPublicationId
  ) {}

  async preview(input: KnowledgePublicationInput): Promise<KnowledgePublicationPreview> {
    const sourcePath = normalizeVaultPath(input.sourcePath);
    const title = sanitizeKnowledgeTitle(input.title);
    const targetPath = normalizeKnowledgeTargetPath(input.targetFolder, title);
    const projectPath = input.projectPath ? normalizeVaultPath(input.projectPath) : undefined;
    const templatePath = input.templatePath ? normalizeVaultPath(input.templatePath) : undefined;

    if (sourcePath === targetPath) throw new Error("Knowledge source and target paths must be different.");
    if (templatePath === sourcePath) throw new Error("A template cannot also be the knowledge source note.");
    if (!(await this.vault.exists(sourcePath))) throw new Error(`Knowledge source does not exist: ${sourcePath}`);
    await this.assertTargetAvailable(targetPath);

    const sourceBefore = await this.vault.read(sourcePath);
    const previousTarget = parseFrontmatter(sourceBefore)?.fields.quiet_workbench_published_to;
    if (typeof previousTarget === "string" && previousTarget.trim()) {
      throw new KnowledgeSourceAlreadyPublishedError(sourcePath, previousTarget.trim());
    }
    const now = input.now ?? new Date();
    const id = this.idFactory(sourcePath, targetPath, now);
    const template = templatePath ? await this.readTemplate(templatePath) : defaultKnowledgeTemplate();
    const rendered = this.templates.render(template, { title, now });
    const targetContent = buildTargetContent(rendered, sourceBefore, {
      id,
      sourcePath,
      projectPath,
      title,
      now
    });
    const sourceAfter = markPublishedSource(sourceBefore, {
      id,
      targetPath,
      projectPath,
      status: input.sourceStatus ?? DEFAULT_SOURCE_STATUS,
      now
    });
    const plan: TransactionPlan = {
      id,
      label: `Publish knowledge: ${title}`,
      operations: [
        { kind: "create", path: targetPath, content: targetContent },
        {
          kind: "write",
          path: sourcePath,
          content: sourceAfter,
          expectedRevision: contentRevision(sourceBefore)
        }
      ]
    };

    return {
      id,
      sourcePath,
      targetPath,
      templatePath,
      projectPath,
      sourceBefore,
      sourceAfter,
      targetContent,
      plan
    };
  }

  private async readTemplate(path: string): Promise<string> {
    if (!(await this.vault.exists(path))) throw new Error(`Knowledge template does not exist: ${path}`);
    return this.vault.read(path);
  }

  private async assertTargetAvailable(targetPath: string): Promise<void> {
    if (await this.vault.exists(targetPath)) throw new KnowledgePublicationConflictError(targetPath);
    const normalizedTarget = comparablePath(targetPath);
    const targetFolder = targetPath.slice(0, targetPath.lastIndexOf("/"));
    const files = await this.vault.listMarkdownFiles(targetFolder);
    const conflicting = files.find((file) => comparablePath(file.path) === normalizedTarget);
    if (conflicting) throw new KnowledgePublicationConflictError(conflicting.path);
  }
}

export function normalizeKnowledgeTargetPath(targetFolder: string, title: string): string {
  const folder = normalizeVaultPath(targetFolder.replace(/[\\/]+$/u, ""));
  return normalizeVaultPath(`${folder}/${sanitizeKnowledgeTitle(title)}.md`);
}

export function sanitizeKnowledgeTitle(value: string): string {
  const title = replaceControlCharacters(value)
    .normalize("NFC")
    .trim()
    .replace(/\.md$/iu, "")
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\s{2,}/gu, " ")
    .replace(/[. ]+$/gu, "");
  if (!title || title === "." || title === "..") throw new Error("Knowledge title cannot be empty.");
  return title;
}

interface PublicationMetadata {
  id: string;
  projectPath?: string;
  now: Date;
}

function buildTargetContent(
  renderedTemplate: string,
  source: string,
  metadata: PublicationMetadata & { sourcePath: string; title: string }
): string {
  const sourceBody = markdownBody(source).trim();
  const normalizedTemplate = normalizeNewlines(renderedTemplate);
  const withContent = normalizedTemplate.includes(CONTENT_MARKER)
    ? normalizedTemplate.replace(CONTENT_MARKER, sourceBody)
    : appendSourceContent(normalizedTemplate, sourceBody);
  return setFrontmatterFields(withContent, {
    title: metadata.title,
    type: "知识",
    source_note: wikiLink(metadata.sourcePath),
    project: metadata.projectPath ? wikiLink(metadata.projectPath) : undefined,
    quiet_workbench_publication_id: metadata.id,
    created: localDate(metadata.now)
  }, false);
}

function markPublishedSource(
  source: string,
  metadata: PublicationMetadata & { targetPath: string; status: KnowledgePublicationInput["sourceStatus"] }
): string {
  return setFrontmatterFields(source, {
    triage_status: metadata.status ?? DEFAULT_SOURCE_STATUS,
    project: metadata.projectPath ? wikiLink(metadata.projectPath) : undefined,
    quiet_workbench_published_to: wikiLink(metadata.targetPath),
    quiet_workbench_publication_id: metadata.id,
    quiet_workbench_published_at: metadata.now.toISOString()
  });
}

function setFrontmatterFields(
  content: string,
  fields: Record<string, string | undefined>,
  overwrite = true
): string {
  const normalized = normalizeNewlines(content);
  const parsed = parseFrontmatter(normalized);
  const activeFields = Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (!parsed) {
    const header = activeFields.map(([key, value]) => `${key}: ${encodeYamlScalar(value)}`).join("\n");
    return `---\n${header}\n---\n${normalized.replace(/^\s*/u, "")}`;
  }

  const lines = normalized.split("\n");
  const header = lines.slice(1, parsed.endLine);
  for (const [key, value] of activeFields) {
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`, "u");
    const index = header.findIndex((line) => pattern.test(line));
    if (index >= 0) {
      if (overwrite) {
        header[index] = `${key}: ${encodeYamlScalar(value)}`;
        while (index + 1 < header.length && /^\s+/u.test(header[index + 1] ?? "")) {
          header.splice(index + 1, 1);
        }
      }
    } else {
      header.push(`${key}: ${encodeYamlScalar(value)}`);
    }
  }
  return ["---", ...header, "---", ...lines.slice(parsed.endLine + 1)].join("\n");
}

function markdownBody(content: string): string {
  const normalized = normalizeNewlines(content);
  const parsed = parseFrontmatter(normalized);
  return parsed ? normalized.split("\n").slice(parsed.endLine + 1).join("\n") : normalized;
}

function appendSourceContent(template: string, body: string): string {
  const base = template.trimEnd();
  if (!body) return `${base}\n`;
  return `${base}\n\n## 来源内容\n\n${body}\n`;
}

function defaultKnowledgeTemplate(): string {
  return ["---", "type: 知识", "created: <% tp.date.now(\"YYYY-MM-DD\") %>", "---", "# <% tp.file.title %>", "", CONTENT_MARKER, ""].join("\n");
}

function wikiLink(path: string): string {
  return `[[${normalizeVaultPath(path).replace(/\.md$/iu, "")}]]`;
}

function encodeYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function comparablePath(path: string): string {
  return normalizeVaultPath(path).normalize("NFC").toLowerCase();
}

function localDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultPublicationId(sourcePath: string, targetPath: string, now: Date): string {
  return `qwb-knowledge-${stableHash(`${sourcePath}\n${targetPath}\n${now.toISOString()}`)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function replaceControlCharacters(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
}
