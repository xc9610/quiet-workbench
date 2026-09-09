export interface NoteContentInput {
  title: string;
  body?: string;
  relatedClient?: string;
  relatedProject?: string;
}

export const DEFAULT_PROJECT_NOTE_FOLDER = "10_业务_Business/04_方案资产_SolutionAssets";

export function renderNoteMarkdown(input: NoteContentInput, created: string): string {
  const frontmatter = ["---", "type: 项目文件", `created: ${created}`];
  if (input.relatedClient) frontmatter.push(`client: ${JSON.stringify(toWikiLink(input.relatedClient))}`);
  if (input.relatedProject) frontmatter.push(`project: ${JSON.stringify(toWikiLink(input.relatedProject))}`);
  frontmatter.push("---", "", `# ${input.title.trim()}`);
  const body = input.body?.trim();
  return `${[...frontmatter, ...(body ? ["", body] : [])].join("\n")}\n`;
}

function toWikiLink(path: string): string {
  const target = path.trim().replace(/^\[\[/u, "").replace(/\]\]$/u, "").replace(/\.md$/iu, "");
  if (!target || /[\r\n]/u.test(target)) throw new Error("关联笔记路径无效。");
  return `[[${target}]]`;
}
