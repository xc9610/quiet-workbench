export type HeroCopyMode = "daily" | "contextual" | "custom";

export interface HeroCopy {
  title: string;
  subtitle: string;
}

export interface HeroCopySettings {
  mode: HeroCopyMode;
  customCopies: HeroCopy[];
}

export interface HeroCopyContext {
  overdue: number;
  dueToday: number;
  upcoming: number;
  missingNext: number;
}

export const DEFAULT_HERO_COPIES: readonly HeroCopy[] = [
  { title: "今天，继续推进", subtitle: "先看清下一步，再把分散的信息带回项目。" },
  { title: "先收拢，再出发", subtitle: "从最值得推进的一件事开始。" },
  { title: "让事情重新有序", subtitle: "把任务、会议和项目重新放回节奏。" },
  { title: "回到项目的下一步", subtitle: "清晰比忙碌更接近完成。" },
  { title: "给重要的事留出空间", subtitle: "今天不必做完所有，只要推进关键节点。" },
  { title: "整理已知，推动未知", subtitle: "记录、判断，然后行动。" }
];

export const DEFAULT_HERO_SETTINGS: HeroCopySettings = {
  mode: "daily",
  customCopies: []
};

export function selectHeroCopy(
  settings: HeroCopySettings,
  dateKey: string,
  context: HeroCopyContext
): HeroCopy {
  if (settings.mode === "contextual") {
    if (context.overdue > 0) {
      return { title: "先收拢，再出发", subtitle: "先处理最需要关注的逾期事项，再回到今天的推进节奏。" };
    }
    if (context.dueToday > 0) {
      return { title: "把今天放回手边", subtitle: "看清今天到期的事项，再决定接下来的一步。" };
    }
    if (context.missingNext > 0) {
      return { title: "回到项目的下一步", subtitle: "为没有下一步的项目补上一条清晰行动。" };
    }
    if (context.upcoming > 0) {
      return { title: "为接下来留出余地", subtitle: "提前看见未来七天，让推进更从容。" };
    }
  }

  const custom = normalizeHeroCopies(settings.customCopies);
  const pool = settings.mode === "custom" && custom.length ? custom : DEFAULT_HERO_COPIES;
  return pool[stableDailyIndex(dateKey, pool.length)];
}

export function parseHeroCopyLines(value: string): HeroCopy[] {
  return normalizeHeroCopies(value.split(/\r?\n/).map((line) => {
    const separator = line.includes("｜") ? "｜" : "|";
    const [title, ...subtitleParts] = line.split(separator);
    return { title: title ?? "", subtitle: subtitleParts.join(separator) };
  }));
}

export function serializeHeroCopies(copies: readonly HeroCopy[]): string {
  return normalizeHeroCopies(copies).map((copy) => `${copy.title}｜${copy.subtitle}`).join("\n");
}

function normalizeHeroCopies(copies: readonly HeroCopy[]): HeroCopy[] {
  return copies
    .map((copy) => ({ title: copy.title.trim(), subtitle: copy.subtitle.trim() }))
    .filter((copy) => copy.title.length > 0 && copy.subtitle.length > 0);
}

function stableDailyIndex(dateKey: string, length: number): number {
  let hash = 0;
  for (const character of dateKey) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}
