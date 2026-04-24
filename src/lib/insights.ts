import type { FunnelResult } from '../types'

export function buildInsightsDraft(f: FunnelResult): string {
  const lines: string[] = []

  lines.push(
    `• ${f.partialLeads.toLocaleString()} partial leads in this view (filters + slice). Not final submitters—compare exports the same way over time.`
  )
  lines.push(
    `• Completion is strict: each question counts only if every required answer is given on that question and all earlier questions, in order. Miss question 1 → later questions don’t count.`
  )

  const top = f.topIncrementalDropStep
  if (top) {
    lines.push(
      `• Biggest drop: “${top.label}”—${top.pct.toFixed(1)}% of the ${top.fromCount.toLocaleString()} who completed the prior question didn’t complete this question’s required answers.`
    )
  } else {
    lines.push(
      `• No single question dominates the drop-off; use the funnel table to compare incremental % across questions.`
    )
  }

  const last = f.steps[f.steps.length - 1]
  if (last) {
    lines.push(
      `• Last mapped question “${last.label}”: ${last.completedCount.toLocaleString()} leads (${last.cumulativeRate.toFixed(1)}%) completed through it; everyone else stopped earlier.`
    )
  }

  return lines.join('\n')
}

export function buildRecommendationsDraft(f: FunnelResult): string {
  const lines: string[] = []

  const top = f.topIncrementalDropStep
  if (top && top.fromCount >= 10) {
    lines.push(
      `• Fix “${top.label}” first (${top.pct.toFixed(1)}% drop after the prior question): clearer question text, helper copy, and validation messages—keep mandated asks, but reduce confusion; then re-export and re-check.`
    )
  }

  if (f.partialLeads >= 20 && f.steps.length > 0) {
    const firstCompleted = f.steps[0]?.completedCount ?? 0
    const firstDropPct = f.partialLeads
      ? ((f.partialLeads - firstCompleted) / f.partialLeads) * 100
      : 0
    if (firstDropPct >= 25) {
      lines.push(
        `• ~${firstDropPct.toFixed(1)}% never complete question 1: tighten how much you ask on the first question, plus headline and primary CTA, before later questions.`
      )
    }
  }

  const last = f.steps[f.steps.length - 1]
  if (
    f.steps.length >= 2 &&
    last &&
    f.partialLeads >= 15 &&
    last.cumulativeRate > 0 &&
    last.cumulativeRate < 35
  ) {
    lines.push(
      `• Only ${last.cumulativeRate.toFixed(1)}% complete the last question (“${last.label}”). Cut late surprises and make the final action and expectations obvious.`
    )
  }

  if (lines.length === 0) {
    lines.push(
      `• Use the funnel table: sort by incremental drop, pick one question, change copy or order—not everything at once.`
    )
    lines.push(
      `• Pair numbers with context: audience, device, traffic source.`
    )
  }

  lines.push(
    `• After changes, upload a new CSV (same slice) and compare the worst question.`
  )

  return lines.join('\n')
}
