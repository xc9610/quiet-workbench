import type { TaskRecord, TaskScope } from "../core/types";

export interface ParsedFrontmatter {
  fields: Record<string, unknown>;
  startLine: number;
  endLine: number;
  raw: string;
}

export interface ParsedMarkdown {
  content: string;
  lines: string[];
  frontmatter?: ParsedFrontmatter;
  tasks: ParsedTask[];
}

export interface ParsedTask extends TaskRecord {
  raw: string;
  indent: string;
  marker: " " | "x" | "X" | "-";
}

export const TASK_PATTERN = /^(\s*)[-*+]\s+\[([ xX-])\]\s+(.*)$/;
const DATE_PATTERN = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const SCHEDULED_PATTERN = /⏳\s*(\d{4}-\d{2}-\d{2})/u;
/** Tasks start date: the task cannot be worked on before this day. It is not a scheduled date. */
const START_PATTERN = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const BLOCK_ID_PATTERN = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/u;
const PRIORITIES: Array<[string, NonNullable<TaskRecord["priority"]>]> = [
  ["⏫", "highest"],
  ["🔺", "highest"],
  ["🔼", "high"],
  ["🔽", "low"],
  ["⏬", "lowest"],
  ["🔻", "lowest"]
];

export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function contentRevision(content: string): string {
  return `fnv1a-${stableHash(normalizeNewlines(content))}`;
}

export function parseMarkdown(
  content: string,
  options: { path?: string; sourceName?: string; scope?: TaskScope; taskHeadings?: string[] } = {}
): ParsedMarkdown {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split("\n");
  const frontmatter = parseFrontmatter(lines);
  const tasks = parseTasks(lines, {
    path: options.path ?? "",
    sourceName: options.sourceName ?? basenameWithoutExtension(options.path ?? ""),
    scope: options.scope ?? "project",
    headings: options.taskHeadings
  });
  return { content: normalized, lines, frontmatter, tasks };
}

export function parseFrontmatter(linesOrContent: string[] | string): ParsedFrontmatter | undefined {
  const lines = Array.isArray(linesOrContent)
    ? linesOrContent
    : normalizeNewlines(linesOrContent).split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  const endLine = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endLine < 0) return undefined;

  const fields: Record<string, unknown> = {};
  let activeListKey: string | undefined;
  for (let index = 1; index < endLine; index += 1) {
    const line = lines[index] ?? "";
    const listMatch = line.match(/^\s*-(?:\s+(.*))?$/);
    if (listMatch && activeListKey) {
      const list = fields[activeListKey];
      if (Array.isArray(list)) list.push(parseScalar(listMatch[1] ?? ""));
      continue;
    }

    if (line.trim() === "" && activeListKey) continue;
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!fieldMatch) {
      activeListKey = undefined;
      continue;
    }
    const key = fieldMatch[1] ?? "";
    const rawValue = (fieldMatch[2] ?? "").trim();
    activeListKey = undefined;
    if (rawValue === "") {
      const nextLine = lines.slice(index + 1, endLine).find((candidate) => candidate.trim() !== "") ?? "";
      const startsList = /^\s*-(?:\s|$)/.test(nextLine);
      fields[key] = startsList ? [] : "";
      if (startsList) activeListKey = key;
      continue;
    }
    const blockScalar = rawValue.match(/^([|>])([+-]?)\d*\s*(?:#.*)?$/u);
    if (blockScalar) {
      const block = collectIndentedLines(lines, index + 1, endLine);
      fields[key] = foldBlockScalar(block.lines, blockScalar[1] === ">", blockScalar[2] ?? "");
      index = block.next - 1;
      continue;
    }
    const quote = rawValue[0];
    if ((quote === '"' || quote === "'") && !closesQuotedScalar(rawValue, quote)) {
      const block = collectIndentedLines(lines, index + 1, endLine);
      fields[key] = parseScalar([rawValue, ...block.lines.map((entry) => entry.trim())].filter(Boolean).join(" "));
      index = block.next - 1;
      continue;
    }
    fields[key] = parseScalar(rawValue);
  }
  return {
    fields,
    startLine: 0,
    endLine,
    raw: lines.slice(0, endLine + 1).join("\n")
  };
}

export function parseTasks(
  linesOrContent: string[] | string,
  options: { path: string; sourceName: string; scope: TaskScope; headings?: string[] }
): ParsedTask[] {
  const lines = Array.isArray(linesOrContent)
    ? linesOrContent
    : normalizeNewlines(linesOrContent).split("\n");
  const tasks: ParsedTask[] = [];
  let fenced = false;
  let currentSection = "";
  const allowedHeadings = options.headings?.map((heading) => heading.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const headingMatch = raw.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 0;
      if (level === 1) currentSection = "";
      else if (level === 2) currentSection = headingMatch[2]?.trim() ?? "";
      continue;
    }
    if (allowedHeadings?.length && !allowedHeadings.includes(currentSection)) continue;
    const match = raw.match(TASK_PATTERN);
    if (!match) continue;
    const marker = (match[2] ?? " ") as " " | "x" | "X" | "-";
    const taskBody = match[3] ?? "";
    const blockId = taskBody.match(BLOCK_ID_PATTERN)?.[1];
    const priority = PRIORITIES.find(([emoji]) => taskBody.includes(emoji))?.[1] ?? "normal";
    const text = cleanTaskText(taskBody);
    const revision = contentRevision(raw);
    tasks.push({
      id: blockId ? `${options.path}#^${blockId}` : `${options.path}#L${index + 1}-${stableHash(raw)}`,
      scope: options.scope,
      path: options.path,
      line: index + 1,
      text,
      completed: marker.toLowerCase() === "x" || marker === "-",
      cancelled: marker === "-",
      due: taskBody.match(DATE_PATTERN)?.[1],
      scheduled: taskBody.match(SCHEDULED_PATTERN)?.[1],
      start: taskBody.match(START_PATTERN)?.[1],
      priority,
      blockId,
      sourceName: options.sourceName,
      revision,
      migrated: /<!--\s*quiet-workbench:migrated\b[\s\S]*?-->/u.test(raw),
      raw,
      indent: match[1] ?? "",
      marker
    });
  }
  return tasks;
}

export function cleanTaskText(taskBody: string): string {
  return taskBody
    .replace(DATE_PATTERN, "")
    .replace(SCHEDULED_PATTERN, "")
    .replace(START_PATTERN, "")
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/➕\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/(?:⏫|🔺|🔼|🔽|⏬|🔻)/gu, "")
    .replace(BLOCK_ID_PATTERN, "")
    .replace(/<!--\s*quiet-workbench:[\s\S]*?-->/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function replaceLine(content: string, oneBasedLine: number, replacement: string): string {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split("\n");
  if (oneBasedLine < 1 || oneBasedLine > lines.length) {
    throw new RangeError(`Line ${oneBasedLine} is outside the document.`);
  }
  lines[oneBasedLine - 1] = replacement;
  return lines.join("\n");
}

export function appendToSection(content: string, heading: string, newLine: string): string {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split("\n");
  const expected = heading.trim();
  const start = lines.findIndex((line) => line.trim() === expected);
  if (start < 0) {
    const base = normalized.replace(/\s+$/u, "");
    return `${base}\n\n${expected}\n\n${newLine}\n`;
  }
  const headingLevel = expected.match(/^(#+)\s/)?.[1]?.length ?? 2;
  let insertion = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const level = lines[index]?.match(/^(#+)\s/)?.[1]?.length;
    if (level !== undefined && level <= headingLevel) {
      insertion = index;
      break;
    }
  }
  while (insertion > start + 1 && (lines[insertion - 1] ?? "").trim() === "") insertion -= 1;
  lines.splice(insertion, 0, newLine);
  return lines.join("\n");
}

export function basenameWithoutExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[[") && value.endsWith("]]")) return value;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineList(inner).map(parseScalar);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Collects blank or indented lines that continue a multi-line value. */
function collectIndentedLines(lines: string[], start: number, end: number): { lines: string[]; next: number } {
  let next = start;
  while (next < end && ((lines[next] ?? "").trim() === "" || /^\s/u.test(lines[next] ?? ""))) next += 1;
  while (next > start && (lines[next - 1] ?? "").trim() === "") next -= 1;
  return { lines: lines.slice(start, next), next };
}

function foldBlockScalar(block: string[], folded: boolean, chomping: string): string {
  const indent = Math.min(...block.filter((line) => line.trim() !== "").map((line) => line.match(/^\s*/u)?.[0].length ?? 0));
  const dedented = block.map((line) => line.slice(Number.isFinite(indent) ? indent : 0));
  const text = folded
    ? dedented.reduce((result, line, index) => {
        if (index === 0) return line;
        if (line.trim() === "") return `${result}\n`;
        return result.endsWith("\n") || result === "" ? `${result}${line}` : `${result} ${line}`;
      }, "")
    : dedented.join("\n");
  if (chomping === "-") return text.replace(/\n+$/u, "");
  return text === "" ? "" : `${text.replace(/\n+$/u, "")}\n`;
}

function closesQuotedScalar(value: string, quote: string): boolean {
  if (value.length < 2 || !value.endsWith(quote)) return false;
  if (quote === '"') {
    const trailingBackslashes = value.slice(0, -1).match(/\\*$/u)?.[0].length ?? 0;
    return trailingBackslashes % 2 === 0;
  }
  return true;
}

function splitInlineList(value: string): string[] {
  const result: string[] = [];
  let quote = "";
  let current = "";
  for (const character of value) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
    } else if (character === "," && !quote) {
      result.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
