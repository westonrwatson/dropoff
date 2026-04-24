import type { RefObject } from 'react'
import type { FunnelResult } from '../types'

type Props = {
  funnel: FunnelResult
  tableCaptureRef?: RefObject<HTMLDivElement | null>
}

export function FunnelTable({ funnel, tableCaptureRef }: Props) {
  if (funnel.steps.length === 0) return null

  function rowText(): string {
    const lines = [
      'Question #\tLabel\tCompleted through\tCumulative %\tIncremental drop %',
      ...funnel.steps.map(
        (s) =>
          `${s.stepIndex}\t${s.label}\t${s.completedCount}\t${s.cumulativeRate.toFixed(1)}\t${s.incrementalDropPct === null ? '' : s.incrementalDropPct.toFixed(1)}`
      ),
    ]
    return lines.join('\n')
  }

  async function copy() {
    await navigator.clipboard.writeText(rowText())
  }

  return (
    <section className="panel funnel-table-panel">
      <div className="table-head">
        <div>
          <h3>Funnel table</h3>
          <p className="hint table-caption">
            Completed through: count who finished required answers on this
            question and all prior questions. Cumulative % is that count divided
            by rows in this view.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={copy}>
          Copy as TSV
        </button>
      </div>
      <div ref={tableCaptureRef} className="table-scroll pdf-funnel-table-capture">
        <table className="funnel-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Completed through</th>
              <th>Cumulative %</th>
              <th>Incremental drop %</th>
            </tr>
          </thead>
          <tbody>
            {funnel.steps.map((s) => (
              <tr key={s.stepIndex}>
                <td>{s.stepIndex}</td>
                <td>{s.label}</td>
                <td>{s.completedCount.toLocaleString()}</td>
                <td>{s.cumulativeRate.toFixed(1)}%</td>
                <td>
                  {s.incrementalDropPct === null
                    ? '—'
                    : `${s.incrementalDropPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
