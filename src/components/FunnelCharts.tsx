import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RefObject } from 'react'
import {
  APP_ACCENT_HEX,
  chartPaletteFromAccent,
  normalizeHex,
} from '../lib/chartAccent'
import {
  DROP_CHART_DESCRIPTION,
  DROP_CHART_HINT,
  DROP_CHART_SECTION_TITLE,
  REACH_CHART_DESCRIPTION,
  REACH_CHART_SECTION_TITLE,
} from '../lib/chartSectionCopy'
import type { FunnelResult } from '../types'

type Props = {
  funnel: FunnelResult
  reachSectionRef?: RefObject<HTMLDivElement | null>
  dropSectionRef?: RefObject<HTMLDivElement | null>
  /** Dashboard school accent; charts follow this hex. */
  accentHex?: string
}

/** Word-aware wrap for Y-axis ticks (no ellipsis). */
function tickLines(text: string, maxChars: number): string[] {
  const t = text.trim()
  if (t.length <= maxChars) return [t]
  const lines: string[] = []
  let rest = t
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      lines.push(rest)
      break
    }
    let cut = rest.lastIndexOf(' ', maxChars)
    if (cut <= 0) cut = maxChars
    lines.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return lines
}

function maxTickGraphicWidth(labels: string[], charsPerLine: number): number {
  let maxLineLen = 8
  for (const label of labels) {
    for (const line of tickLines(label, charsPerLine)) {
      maxLineLen = Math.max(maxLineLen, line.length)
    }
  }
  /* Generous px/char for 0.9rem UI sans (wide glyphs); avoids left clip. */
  return Math.min(560, Math.max(88, Math.ceil(maxLineLen * 6.75) + 32))
}

/** Shorter lines → more two-line wraps, less horizontal span per line. */
const TICK_CHARS = 30

/** Extra right space so bar-end % labels are not clipped (screen + PDF capture). */
const CHART_MARGIN = { left: 48, right: 68, top: 8, bottom: 8 } as const
/** Line spacing between wrapped tick lines (matches ~1.35 line-height on 0.9rem). */
const TICK_LINE_EM = 1.35

function CategoryAxisTick(props: {
  x?: string | number
  y?: string | number
  payload?: { value?: string }
}) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const value = String(props.payload?.value ?? '')
  const lines = tickLines(value, TICK_CHARS)
  const offsetEm = (-(lines.length - 1) * TICK_LINE_EM) / 2
  return (
    <g transform={`translate(${x},${y})`}>
      <text className="chart-y-tick" textAnchor="end">
        {lines.map((line, i) => (
          <tspan
            key={i}
            x={0}
            dy={i === 0 ? `${offsetEm}em` : `${TICK_LINE_EM}em`}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

type ReachRow = {
  name: string
  label: string
  cumulative: number
  completedCount: number
}

type DropRow = {
  name: string
  label: string
  dropped: number
  droppedPct: number
  isHighest: boolean
}

function ReachTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: ReachRow }[]
}) {
  if (!active || !payload?.[0]) return null
  const row = payload[0].payload
  return (
    <div className="chart-tooltip-box">
      <div className="chart-tooltip-step">{row.name}</div>
      <div className="chart-tooltip-full">{row.label}</div>
      <div className="chart-tooltip-main">
        {row.cumulative.toFixed(1)}% (
        {row.completedCount.toLocaleString()} completed through this question)
      </div>
    </div>
  )
}

function DropTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: DropRow }[]
}) {
  if (!active || !payload?.[0]) return null
  const row = payload[0].payload
  return (
    <div className="chart-tooltip-box">
      <div className="chart-tooltip-step">{row.name}</div>
      <div className="chart-tooltip-full">{row.label}</div>
      <div className="chart-tooltip-main">
        {row.droppedPct.toFixed(1)}% of partial leads did not complete this question
        ({row.dropped.toLocaleString()} leads)
      </div>
    </div>
  )
}

export function FunnelCharts({
  funnel,
  reachSectionRef,
  dropSectionRef,
  accentHex,
}: Props) {
  const palette = useMemo(
    () =>
      chartPaletteFromAccent(
        normalizeHex(accentHex ?? '') ?? APP_ACCENT_HEX
      ),
    [accentHex]
  )

  const [barLabelFill, setBarLabelFill] = useState('#292524')
  useEffect(() => {
    const q = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setBarLabelFill(q.matches ? '#e7e5e4' : '#292524')
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [])

  if (funnel.steps.length === 0) {
    return (
      <p className="empty-charts">
        Map at least one question with CSV columns to see charts.
      </p>
    )
  }

  const stepLabels = funnel.steps.map((s) => s.label)
  const yAxisWidth = maxTickGraphicWidth(stepLabels, TICK_CHARS)
  const linesPerStep = stepLabels.map((l) => tickLines(l, TICK_CHARS).length)
  const maxLines = Math.max(1, ...linesPerStep)
  const approxLineBlockPx = maxLines * 14.4 * TICK_LINE_EM
  const chartHeight = Math.max(
    380,
    funnel.steps.length * Math.max(46, 16 + approxLineBlockPx)
  )

  const reachData: ReachRow[] = funnel.steps.map((s) => ({
    name: `Question ${s.stepIndex}`,
    label: s.label,
    cumulative: Number(s.cumulativeRate.toFixed(1)),
    completedCount: s.completedCount,
  }))

  const highlightIdx = funnel.topIncrementalDropStepIndex

  const dropData: DropRow[] = funnel.steps.map((s, i) => {
    const prevCompleted =
      i === 0 ? funnel.partialLeads : funnel.steps[i - 1]!.completedCount
    const dropped = prevCompleted - s.completedCount
    const droppedPct =
      funnel.partialLeads > 0 ? (dropped / funnel.partialLeads) * 100 : 0
    return {
      name: `Question ${s.stepIndex}`,
      label: s.label,
      dropped,
      droppedPct: Number(droppedPct.toFixed(1)),
      isHighest: highlightIdx !== null && i === highlightIdx,
    }
  })

  return (
    <div className="charts-stack">
      <section className="panel chart-panel pdf-capture-chart-reach">
        <h3>{REACH_CHART_SECTION_TITLE}</h3>
        <p className="hint">{REACH_CHART_DESCRIPTION}</p>
        <div ref={reachSectionRef} className="chart-wrap">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={reachData}
              layout="vertical"
              margin={{ ...CHART_MARGIN }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" className="chart-grid" />
              <XAxis type="number" domain={[0, 100]} unit="%" />
              <YAxis
                type="category"
                dataKey="label"
                width={yAxisWidth}
                tick={CategoryAxisTick}
                interval={0}
              />
              <Tooltip
                content={<ReachTooltip />}
                cursor={{ fill: palette.hoverRgba }}
              />
              <Bar
                dataKey="cumulative"
                name="Completion"
                fill={palette.reach}
                radius={[0, 4, 4, 0]}
                maxBarSize={34}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="cumulative"
                  position="right"
                  offset={8}
                  fill={barLabelFill}
                  fontSize={12}
                  fontWeight={600}
                  zIndex={4000}
                  className="chart-bar-end-label"
                  formatter={(label) => {
                    if (label == null || typeof label === 'boolean')
                      return ''
                    const n = Number(label)
                    return Number.isFinite(n) ? `${n}%` : ''
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel chart-panel pdf-capture-chart-drop">
        <h3>{DROP_CHART_SECTION_TITLE}</h3>
        <p className="hint">{DROP_CHART_DESCRIPTION}</p>
        <p className="hint">{DROP_CHART_HINT}</p>
        <div ref={dropSectionRef} className="chart-wrap">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={dropData}
              layout="vertical"
              margin={{ ...CHART_MARGIN }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" className="chart-grid" />
              <XAxis type="number" domain={[0, 100]} unit="%" />
              <YAxis
                type="category"
                dataKey="label"
                width={yAxisWidth}
                tick={CategoryAxisTick}
                interval={0}
              />
              <Tooltip
                content={<DropTooltip />}
                cursor={{ fill: palette.hoverRgba }}
              />
              <Bar
                dataKey="droppedPct"
                name="Stopped"
                radius={[0, 4, 4, 0]}
                maxBarSize={34}
                isAnimationActive={false}
              >
                {dropData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={
                      entry.isHighest
                        ? palette.dropHighlight
                        : palette.dropMuted
                    }
                  />
                ))}
                <LabelList
                  dataKey="droppedPct"
                  position="right"
                  offset={8}
                  fill={barLabelFill}
                  fontSize={12}
                  fontWeight={600}
                  zIndex={4000}
                  className="chart-bar-end-label"
                  formatter={(label) => {
                    if (label == null || typeof label === 'boolean')
                      return ''
                    const n = Number(label)
                    return Number.isFinite(n) ? `${n.toFixed(1)}%` : ''
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
