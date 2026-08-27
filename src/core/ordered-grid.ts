import type { LayoutItem, LayoutSchema } from "./types";

export const ORDERED_GRID_VERSION = 1;
export const ORDERED_GRID_MAX_SPAN = 4;

/**
 * Convert the former twelve-column absolute layout to Xove Dashboard's
 * ordered-card model: DOM order decides placement and each card only owns a
 * column/row span. The old x/y/width/height values remain on the item for
 * backwards-compatible exports; callers keep a complete pre-migration backup.
 */
export function migrateLayoutToOrderedGrid(layout: LayoutSchema): LayoutSchema {
  if (layout.surface !== "workbench") return cloneLayout(layout);
  const ordered = layout.items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.y - right.item.y || left.item.x - right.item.x || left.index - right.index);
  return {
    ...layout,
    items: ordered.map(({ item }, index) => ({
      ...item,
      x: 0,
      y: index,
      cols: clampSpan(item.cols ?? legacyWidthToCols(item.width)),
      rows: clampSpan(item.rows ?? legacyHeightToRows(item.height)),
      config: item.config ? structuredClone(item.config) : undefined
    }))
  };
}

export function migrateLayoutsToOrderedGrid(layouts: LayoutSchema[]): LayoutSchema[] {
  return layouts.map(migrateLayoutToOrderedGrid);
}

export function normalizeOrderedItems(items: LayoutItem[]): LayoutItem[] {
  return items.map((item, index) => ({
    ...item,
    x: 0,
    y: index,
    cols: clampSpan(item.cols ?? legacyWidthToCols(item.width)),
    rows: clampSpan(item.rows ?? legacyHeightToRows(item.height)),
    config: item.config ? structuredClone(item.config) : undefined
  }));
}

export function itemCols(item: LayoutItem, columnCount = ORDERED_GRID_MAX_SPAN): number {
  return Math.min(columnCount, clampSpan(item.cols ?? legacyWidthToCols(item.width)));
}

export function itemRows(item: LayoutItem): number {
  return clampSpan(item.rows ?? legacyHeightToRows(item.height));
}

export function clampSpan(value: number, maximum = ORDERED_GRID_MAX_SPAN): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.max(1, Math.min(maximum, rounded));
}

export function computeOrderedGridColumns(width: number, gap: number, minimumCardWidth = 260): number {
  const fit = Math.floor((width + gap) / (minimumCardWidth + gap));
  return Math.max(1, Math.min(ORDERED_GRID_MAX_SPAN, fit));
}

export function legacyWidthToCols(width: number): number {
  return clampSpan(Math.ceil(Math.max(1, width) / 3));
}

export function legacyHeightToRows(height: number): number {
  return clampSpan(Math.ceil(Math.max(1, height) / 6));
}

function cloneLayout(layout: LayoutSchema): LayoutSchema {
  return {
    ...layout,
    items: layout.items.map((item) => ({
      ...item,
      config: item.config ? structuredClone(item.config) : undefined
    }))
  };
}
