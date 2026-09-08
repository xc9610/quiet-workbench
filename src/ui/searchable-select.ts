export interface SearchableOption {
  value: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
}

export function filterSearchableOptions(
  options: readonly SearchableOption[],
  query: string,
  limit = 30
): SearchableOption[] {
  const normalized = normalizeSearch(query);
  const rows = normalized
    ? options.filter((option) => [option.label, option.description, ...(option.keywords ?? [])]
      .filter(Boolean)
      .some((value) => normalizeSearch(String(value)).includes(normalized)))
    : [...options];
  return rows.slice(0, Math.max(1, limit));
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}
