import { useMemo } from 'react'
import type { AnalysisTab } from '../types'
import { distinctValues } from '../lib/csv'

type Props = {
  tab: AnalysisTab
  rows: Record<string, string>[]
  headers: string[]
  onChange: (patch: Partial<AnalysisTab>) => void
}

export function VariantFilter({ tab, rows, headers, onChange }: Props) {
  const variants = useMemo(
    () =>
      tab.variantColumn ? distinctValues(rows, tab.variantColumn) : [],
    [rows, tab.variantColumn]
  )

  return (
    <div className="variant-filter">
      <p className="hint variant-filter-hint">
        CSV is one form per tab. On upload, a slice column and default value are
        set when the file has several runs. Leave the value as “All” to include
        every row.
      </p>
      <div className="filter-grid variant-filter-grid">
        <label className="filter-field">
          <span>Slice column</span>
          <select
            value={tab.variantColumn}
            onChange={(e) =>
              onChange({ variantColumn: e.target.value, variantValue: '' })
            }
          >
            <option value="">—</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        {tab.variantColumn ? (
          <label className="filter-field">
            <span>Value</span>
            <select
              value={tab.variantValue}
              onChange={(e) => onChange({ variantValue: e.target.value })}
            >
              <option value="">All</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  )
}
