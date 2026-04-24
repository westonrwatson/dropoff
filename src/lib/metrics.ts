import type { AnalysisTab, FlowStep, FunnelResult, FunnelStepStats } from '../types'

function cellFilled(row: Record<string, string>, column: string): boolean {
  return String(row[column] ?? '').trim() !== ''
}

/**
 * Whether this row has “passed” the step for funnel counts.
 * `anyFilled`: at least one mapped column has data (grouped / branching columns).
 * Otherwise: all required mapped columns filled; if none required, step always passes.
 */
function isStepComplete(row: Record<string, string>, step: FlowStep): boolean {
  if (step.fields.length === 0) return false
  if (step.completionRule === 'anyFilled') {
    return step.fields.some((f) => cellFilled(row, f.column))
  }
  const requiredFields = step.fields.filter((f) => f.required)
  if (requiredFields.length === 0) return true
  return requiredFields.every((f) => cellFilled(row, f.column))
}

/**
 * How many leading questions this row has cleared. Used for funnel counts.
 */
export function lastCompletedStepIndex(
  row: Record<string, string>,
  steps: FlowStep[]
): number {
  let i = 0
  while (i < steps.length) {
    const step = steps[i]!
    if (isStepComplete(row, step)) {
      i++
      continue
    }
    break
  }
  return i
}

export function computeFunnel(
  rowsInScope: Record<string, string>[],
  tab: AnalysisTab
): FunnelResult | null {
  const steps = tab.steps.filter((s) => s.fields.length > 0)
  if (steps.length === 0) return null

  const n = rowsInScope.length
  if (n === 0) {
    return {
      partialLeads: 0,
      topIncrementalDropStep: null,
      topIncrementalDropStepIndex: null,
      steps: [],
    }
  }

  const lastSteps = rowsInScope.map((r) => lastCompletedStepIndex(r, steps))
  const partialLeads = n

  const stepStats: FunnelStepStats[] = []
  let topDrop: { label: string; pct: number; fromCount: number } | null = null
  let topDropIndex: number | null = null

  for (let i = 0; i < steps.length; i++) {
    const completedCount = lastSteps.filter((l) => l >= i + 1).length
    const cumulativeRate = partialLeads ? (completedCount / partialLeads) * 100 : 0

    let incrementalDropPct: number | null = null
    if (i === 0) {
      const failedFirst = partialLeads - completedCount
      incrementalDropPct = partialLeads
        ? (failedFirst / partialLeads) * 100
        : 0
      const fromCount = partialLeads
      if (
        incrementalDropPct > 0 &&
        fromCount >= 5 &&
        (!topDrop || incrementalDropPct > topDrop.pct)
      ) {
        topDrop = {
          label: steps[i]!.label,
          pct: incrementalDropPct,
          fromCount,
        }
        topDropIndex = i
      }
    } else {
      const prevCompleted = lastSteps.filter((l) => l >= i).length
      const lost = prevCompleted - completedCount
      incrementalDropPct =
        prevCompleted > 0 ? (lost / prevCompleted) * 100 : null
      if (
        incrementalDropPct !== null &&
        incrementalDropPct > 0 &&
        prevCompleted >= 5 &&
        (!topDrop || incrementalDropPct > topDrop.pct)
      ) {
        topDrop = {
          label: steps[i]!.label,
          pct: incrementalDropPct,
          fromCount: prevCompleted,
        }
        topDropIndex = i
      }
    }

    stepStats.push({
      stepIndex: i + 1,
      label: steps[i]!.label,
      completedCount,
      cumulativeRate,
      incrementalDropPct,
    })
  }

  return {
    partialLeads,
    topIncrementalDropStep: topDrop,
    topIncrementalDropStepIndex: topDropIndex,
    steps: stepStats,
  }
}
