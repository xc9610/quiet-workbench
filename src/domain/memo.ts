export interface QuickMemoTimestamp {
  date: string;
  time: string;
}

export interface QuickMemoEntry {
  date: string;
  time: string;
  text: string;
}

export function appendQuickMemoContent(
  content: string,
  entry: string,
  timestamp: QuickMemoTimestamp = quickMemoTimestamp(new Date())
): string {
  const normalizedEntry = normalizeQuickMemoEntry(entry);
  const listItem = formatListItem(normalizedEntry, timestamp.time);
  if (!content) return `# Workbench速记\n\n## ${timestamp.date}\n\n${listItem}\n`;

  const lastDate = [...content.replace(/\r\n?/gu, "\n").matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/gmu)].at(-1)?.[1];
  if (lastDate === timestamp.date) {
    const separator = content.endsWith("\n") ? "" : "\n";
    return `${content}${separator}${listItem}\n`;
  }

  const separator = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${separator}## ${timestamp.date}\n\n${listItem}\n`;
}

export function recentQuickMemoEntries(content: string, limit = 6): QuickMemoEntry[] {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const entries: QuickMemoEntry[] = [];
  let date = "";
  let current: QuickMemoEntry | undefined;

  for (const line of lines) {
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/u);
    if (dateMatch) {
      date = dateMatch[1];
      current = undefined;
      continue;
    }
    const entryMatch = line.match(/^-\s+(\d{2}:\d{2})\s+(.+)$/u);
    if (entryMatch) {
      current = { date, time: entryMatch[1], text: entryMatch[2].trim() };
      entries.push(current);
      continue;
    }
    if (current && /^\s{2,}\S/u.test(line)) {
      current.text += `\n${line.trim()}`;
    } else if (line.trim()) {
      current = undefined;
    }
  }

  if (!entries.length) {
    return legacyQuickMemoEntries(content, limit);
  }
  return entries.slice(-limit).reverse();
}

export function quickMemoTimestamp(value: Date): QuickMemoTimestamp {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function normalizeQuickMemoEntry(value: string): string {
  const entry = value.replace(/\r\n?/gu, "\n").trim();
  if (!entry) throw new Error("速记内容不能为空。");
  return entry;
}

function formatListItem(entry: string, time: string): string {
  const [first, ...rest] = entry.split("\n");
  return [`- ${time} ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

function legacyQuickMemoEntries(content: string, limit: number): QuickMemoEntry[] {
  return content
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !/^#{1,2}\s+/u.test(entry))
    .slice(-limit)
    .reverse()
    .map((text) => ({ date: "", time: "", text }));
}
