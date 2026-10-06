import { normalizeNewlines, parseFrontmatter } from "./markdown";

/** A plain string is written as a JSON/YAML double-quoted scalar; `{ raw }` is written verbatim. */
export type FrontmatterFieldValue = string | undefined | { raw: string };

export interface FrontmatterWriteOptions {
  /** What an `undefined` value means: leave the field untouched (default) or remove it. */
  undefinedFields?: "skip" | "delete";
  /** When false, keys that already exist are kept as-is and only missing keys are added. */
  overwrite?: boolean;
  /** Behaviour for notes without frontmatter: create a block, or refuse with the given message. */
  missing?: "create" | { error: string };
}

export class FrontmatterWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterWriteError";
  }
}

/**
 * Sets top-level frontmatter fields without touching anything else.
 *
 * Unlike a single-line regex replacement, the whole value of an existing key is replaced:
 * indented continuation lines, block scalars (`|`, `>`), and block sequences (indented or
 * not) are removed together with the key line. The original BOM and line endings are kept.
 * As a final guard, every field that was not part of the update must parse to the same value
 * before and after the edit; otherwise the write is refused instead of corrupting the note.
 */
export function setFrontmatterFields(
  content: string,
  fields: Record<string, FrontmatterFieldValue>,
  options: FrontmatterWriteOptions = {}
): string {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? content.slice(1) : content;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const normalized = normalizeNewlines(body);
  const lines = normalized.split("\n");
  const undefinedMode = options.undefinedFields ?? "skip";
  const overwrite = options.overwrite ?? true;

  const endLine = lines[0]?.trim() === "---"
    ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    : -1;

  if (endLine < 0) {
    const missing = options.missing ?? { error: "笔记缺少有效的 YAML frontmatter，未执行写入。" };
    if (missing !== "create") throw new FrontmatterWriteError(missing.error);
    const header = Object.entries(fields)
      .filter((entry): entry is [string, Exclude<FrontmatterFieldValue, undefined>] => entry[1] !== undefined)
      .map(([key, value]) => `${key}: ${encodeValue(value)}`);
    const result = ["---", ...header, "---", normalized.replace(/^\s*/u, "")].join("\n");
    return bom + restoreLineEndings(result, eol);
  }

  const header = lines.slice(1, endLine);
  for (const [key, value] of Object.entries(fields)) {
    assertValidKey(key);
    const index = header.findIndex((line) => keyPattern(key).test(line));
    const extent = index >= 0 ? valueExtent(header, index) : 0;
    if (value === undefined) {
      if (undefinedMode === "delete" && index >= 0) header.splice(index, extent);
      continue;
    }
    if (index >= 0 && !overwrite) continue;
    const line = `${key}: ${encodeValue(value)}`;
    if (index >= 0) header.splice(index, extent, line);
    else header.push(line);
  }

  const result = ["---", ...header, "---", ...lines.slice(endLine + 1)].join("\n");
  assertUntouchedFieldsPreserved(normalized, result, Object.keys(fields));
  return bom + restoreLineEndings(result, eol);
}

/** Number of header lines (starting at `index`) that belong to the key on line `index`. */
function valueExtent(header: string[], index: number): number {
  let end = index + 1;
  while (end < header.length && isContinuationLine(header[end] ?? "")) end += 1;
  // Blank lines directly before the next key are separators, not part of this value.
  while (end - 1 > index && (header[end - 1] ?? "").trim() === "") end -= 1;
  return end - index;
}

function isContinuationLine(line: string): boolean {
  if (line.trim() === "") return true;
  if (/^\s/u.test(line)) return true;
  // YAML allows block sequence items at the same indentation as their parent key.
  return /^-(?:\s|$)/u.test(line);
}

function keyPattern(key: string): RegExp {
  return new RegExp(`^${escapeRegExp(key)}\\s*:(?:\\s|$)`, "u");
}

function assertValidKey(key: string): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(key)) throw new FrontmatterWriteError(`不支持的 frontmatter 字段名：${key}`);
}

function encodeValue(value: Exclude<FrontmatterFieldValue, undefined>): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (/[\r\n]/u.test(value.raw)) throw new FrontmatterWriteError("frontmatter 原始值不能包含换行。");
  return value.raw;
}

function assertUntouchedFieldsPreserved(before: string, after: string, touched: string[]): void {
  const previous = parseFrontmatter(before);
  const next = parseFrontmatter(after);
  if (!previous || !next) throw new FrontmatterWriteError("写入后 frontmatter 无法解析，已中止写入。");
  const skip = new Set(touched);
  for (const [key, value] of Object.entries(previous.fields)) {
    if (skip.has(key)) continue;
    if (JSON.stringify(next.fields[key]) !== JSON.stringify(value)) {
      throw new FrontmatterWriteError(`写入会改变未修改的 frontmatter 字段「${key}」，已中止写入。`);
    }
  }
}

function restoreLineEndings(content: string, eol: string): string {
  return eol === "\n" ? content : content.replace(/\n/gu, eol);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
