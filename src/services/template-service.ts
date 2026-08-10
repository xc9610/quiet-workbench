export interface TemplateContext {
  title: string;
  now?: Date;
}

export class UnsupportedTemplateExpressionError extends Error {
  constructor(public readonly expressions: string[]) {
    super(`Unsupported template expression${expressions.length === 1 ? "" : "s"}: ${expressions.join(", ")}`);
    this.name = "UnsupportedTemplateExpressionError";
  }
}

/** Renders the two explicitly supported Templater expressions without executing code. */
export class TemplateService {
  render(template: string, context: TemplateContext): string {
    const unsupported: string[] = [];
    const now = context.now ?? new Date();
    const rendered = template.replace(/<%\s*([\s\S]*?)\s*%>/gu, (whole, expression: string) => {
      const normalized = expression.trim();
      if (normalized === "tp.file.title") return context.title;
      const dateMatch = normalized.match(/^tp\.date\.now\(\s*(["'])([^"']+)\1\s*\)$/u);
      if (dateMatch) return formatDate(now, dateMatch[2] ?? "YYYY-MM-DD");
      unsupported.push(whole);
      return whole;
    });
    if (unsupported.length > 0) throw new UnsupportedTemplateExpressionError(unsupported);
    return rendered;
  }
}

export function formatDate(date: Date, format: string): string {
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()).padStart(4, "0"),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    DD: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0")
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token] ?? token);
}
