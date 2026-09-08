import { layoutItemKey } from "./layout";
import type { LayoutItem } from "./types";

export const LAYOUT_HISTORY_LIMIT = 20;

export function cloneLayoutItems(source: LayoutItem[]): LayoutItem[] {
  return source.map((item) => ({
    ...item,
    config: item.config ? structuredClone(item.config) : undefined
  }));
}

export function recordLayoutHistory(
  history: LayoutItem[][],
  items: LayoutItem[],
  limit = LAYOUT_HISTORY_LIMIT
): LayoutItem[][] {
  const maximum = Math.max(1, Math.round(limit));
  return [...history.slice(-(maximum - 1)), cloneLayoutItems(items)];
}

export function patchLayoutItem(
  items: LayoutItem[],
  instanceId: string,
  patch: Partial<LayoutItem>
): LayoutItem[] {
  return items.map((item) => layoutItemKey(item) === instanceId ? { ...item, ...patch } : item);
}

export function removeLayoutItem(items: LayoutItem[], instanceId: string): LayoutItem[] {
  return items.filter((item) => layoutItemKey(item) !== instanceId);
}

export function moveVisibleLayoutItem(
  items: LayoutItem[],
  visibleKeys: string[],
  instanceId: string,
  offset: -1 | 1
): LayoutItem[] {
  const visibleIndex = visibleKeys.indexOf(instanceId);
  const targetKey = visibleKeys[visibleIndex + offset];
  if (visibleIndex < 0 || !targetKey) return items;
  const index = items.findIndex((item) => layoutItemKey(item) === instanceId);
  const target = items.findIndex((item) => layoutItemKey(item) === targetKey);
  if (index < 0 || target < 0) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
