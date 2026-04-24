import { useState } from 'react'
import type { FlowStep, FunnelResult } from '../types'
import {
  canRunAiWithoutBrowserKey,
  generateFillFromMetricsAi,
  INSIGHTS_LITE_MODEL,
  isGeminiQuotaOrLimitError,
} from '../lib/aiInsights'
import { RichTextInsightsEditor } from './RichTextInsightsEditor'

/** Integrated Gemini: dev uses `/api/gemini` + GEMINI_API_KEY in `.env.local`; optional env overrides. */
const INTEGRATED_AI_SETTINGS = {
  apiKey: '',
  baseUrl: '',
  model: '',
} as const

type Props = {
  funnel: FunnelResult | null
  /** Mapped flow so AI can align insights/recs with question titles and order. */
  flowSteps: FlowStep[]
  tabTitle: string
  insightsText: string
  recommendationsText: string
  onInsightsChange: (v: string) => void
  onRecommendationsChange: (v: string) => void
  onAiFilled: (insights: string, recommendations: string) => void
}

export function InsightsPanel({
  funnel,
  flowSteps,
  tabTitle,
  insightsText,
  recommendationsText,
  onInsightsChange,
  onRecommendationsChange,
  onAiFilled,
}: Props) {
  const [fillMetricsBusy, setFillMetricsBusy] = useState(false)
  const [aiErr, setAiErr] = useState<string | null>(null)
  /** After quota/rate-limit errors, next click retries Lite only (no Flash fallback). */
  const [useLiteOnNextFill, setUseLiteOnNextFill] = useState(false)

  async function runFillMetricsAi() {
    if (!funnel || funnel.steps.length === 0) return
    setAiErr(null)
    setFillMetricsBusy(true)
    const forceLite = useLiteOnNextFill
    try {
      const { insights, recommendations } = await generateFillFromMetricsAi(
        funnel,
        tabTitle,
        INTEGRATED_AI_SETTINGS,
        flowSteps,
        { forceLiteModel: forceLite }
      )
      setUseLiteOnNextFill(false)
      onAiFilled(insights, recommendations)
    } catch (e) {
      if (isGeminiQuotaOrLimitError(e)) {
        setUseLiteOnNextFill(true)
      }
      setAiErr(e instanceof Error ? e.message : 'AI request failed')
    } finally {
      setFillMetricsBusy(false)
    }
  }

  const aiReady = canRunAiWithoutBrowserKey(INTEGRATED_AI_SETTINGS)
  const fillDisabled =
    !funnel ||
    funnel.steps.length === 0 ||
    !aiReady ||
    fillMetricsBusy

  return (
    <div className="insights-grid">
      {aiErr ? (
        <p className="insights-error-below">{aiErr}</p>
      ) : null}

      <section className="panel insights-panel-block">
        <h3>Key insights</h3>
        <RichTextInsightsEditor
          className="insights-text"
          value={insightsText}
          onChange={onInsightsChange}
          placeholder="Key insights…"
        />
      </section>
      <section className="panel insights-panel-block">
        <h3>Recommendations</h3>
        <RichTextInsightsEditor
          className="insights-text"
          value={recommendationsText}
          onChange={onRecommendationsChange}
          placeholder="Recommendations…"
        />
      </section>
      <div className="insights-fill-foot">
        <div className="insights-fill-foot-inner">
          <button
            type="button"
            className="btn secondary fill-from-metrics-btn"
            disabled={fillDisabled}
            onClick={() => void runFillMetricsAi()}
          >
            <span className="fill-from-metrics-sparkles" aria-hidden="true">
              <span className="fill-from-metrics-spark fill-from-metrics-spark--a">
                ✦
              </span>
              <span className="fill-from-metrics-spark fill-from-metrics-spark--b">
                ✦
              </span>
            </span>
            <span className="fill-from-metrics-label">
              {fillMetricsBusy ? 'Filling…' : 'Fill from metrics'}
            </span>
          </button>
          {useLiteOnNextFill && !fillMetricsBusy ? (
            <p className="insights-fill-lite-hint" role="status">
              Next fill uses <code>{INSIGHTS_LITE_MODEL}</code> only (no upgrade to
              Flash on timeout).
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
