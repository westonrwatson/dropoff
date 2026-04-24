import type { AnalysisTab } from '../types'

/** Optional variant slice only (one form per CSV). */
export function filterTabRows(
  rows: Record<string, string>[],
  tab: AnalysisTab
): Record<string, string>[] {
  if (!tab.variantColumn || !tab.variantValue) return rows
  return rows.filter(
    (row) =>
      String(row[tab.variantColumn] ?? '').trim() === tab.variantValue
  )
}
