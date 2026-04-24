import type { FlowStep, FunnelResult } from '../types'
import {
  DROP_CHART_HINT,
  DROP_CHART_SECTION_TITLE,
  REACH_CHART_SECTION_TITLE,
} from './chartSectionCopy'

/**
 * Tuned for small/fast models (e.g. gemini-2.5-flash-lite): short sentences,
 * numbered rules, separate INSIGHTS vs RECOMMENDATIONS jobs.
 */
const FILL_FROM_METRICS_SYSTEM = `You write form drop-off analysis for busy enrollment and marketing leaders.

CONTEXT (this form—assume true)
- Contact/personal info (name, email, phone, address) is already at the end of the flow. Do not recommend "move contact to the end" as if it were not already there.
- This team tested splitting contact collection across two pages; it did not improve completion. Do not recommend breaking contact into multiple pages or screens.

RULES
1. Data = partial leads only. Never say they submitted, converted, or finished the entire form.
2. Use "question" not "step". Use question titles from the JSON—never raw CSV column headers or the word "field".
3. Output exactly 4 bullets: 2 under INSIGHTS, 2 under RECOMMENDATIONS. Start lines with "• ".

INSIGHTS (2 bullets)
- Name the main drop-off points. Be clear and brief—not wordy.
- Use numbers from the payload (counts, %, question titles). One bullet may emphasize cumulative reach; one may emphasize where students stopped (highlighted bar).
- Before you finish: double-check INSIGHTS against the JSON so every stat matches the charts. Reach/cumulative claims must match questions[].cumulativeRate and completedCount vs partialLeads. Drop/stopped claims must match whereStudentsStopped[] (stoppedCount, stoppedPctOfPartialLeads). The **highlighted (darker) bar** on the drop chart = row with isHighlightedOnWhereStudentsStoppedChart true (largest incremental step-to-step drop; same question as biggestDropQuestion when present)—it is **not** always the longest bar. If you cite biggestDropQuestion, its pct/fromCount must match that object—not the stopped chart % (different denominator). The row with max stoppedCount can differ from the highlighted row; do not conflate them.
- You may add one short "why" per bullet when it fits the data (e.g. sensitive ask, long or vague question)—no long speculation.

RECOMMENDATIONS (2 bullets)
- Must be actionable: imperative verbs (e.g. Rewrite…, Reorder…, Narrow…, Standardize…). One concrete change per bullet—it can be **question-specific** or **form-wide / general** (e.g. consistent tone across questions, stronger opening framing before Q1, reducing repeated asks, clearer section flow)—still specific enough to act on, not vague "improve UX." Do not recommend splitting contact/personal fields across two pages (tested; not effective).
- When useful, add a very short example after the recommendation—e.g. revised question wording, option labels, or occasionally helper text. Format: main point, then "Example: …" (example under ~20 words).
- Help text alone is not always the right fix for completion or click-through; do not default both bullets to "add helper text." Also consider shorter questions, fewer or clearer answer choices, relevance of the ask, and optional vs required—pick the lever that fits the drop-off pattern.
- Use form-completion best practices: clearer labels, fewer confusing options, trust and purpose on the contact section. Contact is already last—focus on copy, optional vs required clarity, and substantive wording—not only inline help, and not reordering contact earlier or later.
- For program of interest, major, anticipated program, or similar picks, adding an **Unsure** or **Undecided** option (wording may vary) is often a good idea—reduces forced choices and abandonment when prospects are not ready to commit. Suggest it when that question theme appears in the data or formFlow.
- When contact/personal info matters, suggest tactics like sharper microcopy, why you need it, obvious optional vs required—not moving the block, not splitting it across pages, not "put email on page 1 and phone on page 2."
- Never recommend moving contact/personal information earlier in the flow, to the first screen, or to "lead with" name/email/phone—same as do not move email, phone, or name up in the order.
- Forbidden: mobile/responsive/touch, progress bars, step counters, wayfinding, empty "improve UX" with no concrete lever (question-level or whole-form), recommending new charts or dashboards.

QUALITY
- INSIGHTS must be chart-accurate: re-read the metrics JSON once and fix any mismatch before output.
- No repeated stats or duplicate thesis between INSIGHTS and RECOMMENDATIONS.
- Recommendations: concise; main advice ≤2 short sentences per bullet, plus optional "Example: …" line as above.`

const FORM_FLOW_LEGEND = `formFlow = question order in this analysis. req/opt = required vs optional mapped columns (internal). funnelCompletion "anyOfColumns" = step counts as answered if any mapped column has a value (grouped branching columns).`

/** Official REST host (path continues with /v1beta/models/...). */
const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com'
/**
 * Fill-from-metrics: `gemini-2.5-flash-lite` first, then `gemini-2.5-flash` on timeout.
 * Override with `VITE_GEMINI_INSIGHTS_LITE_MODEL` / `VITE_GEMINI_INSIGHTS_FALLBACK_MODEL` only.
 * @see https://ai.google.dev/gemini-api/docs/rate-limits
 */
export const INSIGHTS_LITE_MODEL =
  import.meta.env.VITE_GEMINI_INSIGHTS_LITE_MODEL?.trim() ||
  'gemini-2.5-flash-lite'

const DEFAULT_GEMINI_MODEL = INSIGHTS_LITE_MODEL

/** First tier: abort each attempt after this many ms, then try `INSIGHTS_FALLBACK_MODEL` (Flash). */
const INSIGHTS_PRIMARY_TIMEOUT_MS = (() => {
  const raw = import.meta.env.VITE_GEMINI_INSIGHTS_PRIMARY_TIMEOUT_MS
  if (raw === undefined || raw === '') return 28_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 5_000 ? n : 28_000
})()

/** Heavier model used after Lite times out (or override via env). */
export const INSIGHTS_FALLBACK_MODEL =
  import.meta.env.VITE_GEMINI_INSIGHTS_FALLBACK_MODEL?.trim() ||
  'gemini-2.5-flash'

/** Per-attempt cap after timeout fallback (ms); 0 = no limit. */
const INSIGHTS_FALLBACK_TIMEOUT_MS = (() => {
  const raw = import.meta.env.VITE_GEMINI_INSIGHTS_FALLBACK_TIMEOUT_MS
  if (raw === undefined || raw === '') return 120_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 120_000
})()

class GeminiTimeoutError extends Error {
  modelId: string
  constructor(message: string, modelId: string) {
    super(message)
    this.name = 'GeminiTimeoutError'
    this.modelId = modelId
  }
}

function resolveGeminiModel(settings: AiInsightsSettings, override?: string): string {
  return (
    override?.trim() ||
    settings.model.trim() ||
    DEFAULT_GEMINI_MODEL
  )
}

/** No heavier tier worth trying (primary is already the slowest / legacy tier). */
function shouldSkipModelFallback(primaryModelId: string): boolean {
  const p = primaryModelId.toLowerCase()
  return p.includes('gemini-2.0-flash') || p === 'gemini-2.0-flash-001'
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * Quota / rate-limit style failures—UI can retry the next fill with Lite only (no Flash upgrade).
 */
export function isGeminiQuotaOrLimitError(e: unknown): boolean {
  const msg =
    e instanceof Error ? e.message : typeof e === 'string' ? e : String(e ?? '')
  return /429|quota|rate\s*limit|resource_exhausted|resource exhausted|exceeded your|limit exceeded|too many requests|billing|payment required/i.test(
    msg
  )
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** Parse "Please retry in 25.88s" from Gemini quota errors. */
function parseRetryAfterSeconds(message: string): number | null {
  const m = message.match(/retry in ([\d.]+)\s*s/i)
  if (!m) return null
  return Math.min(120, Math.max(1, Number.parseFloat(m[1]!)))
}

/** Same-origin dev proxy path (see vite.config.ts). */
export const DEV_GEMINI_PROXY_BASE = '/api/gemini'

/** True if requests can run without a browser-stored API key (dev proxy or same-origin path). */
export function canRunAiWithoutBrowserKey(settings: {
  apiKey: string
  baseUrl: string
}): boolean {
  if (settings.apiKey.trim()) return true
  if (settings.baseUrl.trim().startsWith('/')) return true
  const viteBase = import.meta.env.VITE_GEMINI_BASE_URL?.trim() ?? ''
  if (viteBase.startsWith('/')) return true
  if (import.meta.env.DEV && !settings.baseUrl.trim()) return true
  return false
}

function resolveBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '')
  if (trimmed) return trimmed
  const envBase = import.meta.env.VITE_GEMINI_BASE_URL?.trim().replace(/\/$/, '')
  if (envBase) return envBase
  if (import.meta.env.DEV) return DEV_GEMINI_PROXY_BASE
  return DEFAULT_GEMINI_BASE
}

export type AiInsightsSettings = {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * Same numbers as the “Where Students Stopped” bar chart (drop from prior
 * completers; bar length = stoppedCount / partialLeads as a %).
 * Highlight flag matches the chart’s darker bar: largest **incremental** drop
 * (same step as biggestDropQuestion / KPI), not necessarily the longest bar.
 */
function whereStudentsStoppedForPayload(f: FunnelResult) {
  const hi = f.topIncrementalDropStepIndex
  return f.steps.map((s, i) => {
    const prevCompleted =
      i === 0 ? f.partialLeads : f.steps[i - 1]!.completedCount
    const stoppedCount = prevCompleted - s.completedCount
    const stoppedPctOfPartialLeads = f.partialLeads
      ? Number(((stoppedCount / f.partialLeads) * 100).toFixed(2))
      : 0
    return {
      questionIndex: s.stepIndex,
      questionTitle: s.label,
      stoppedCount,
      stoppedPctOfPartialLeads,
      isHighlightedOnWhereStudentsStoppedChart: hi !== null && i === hi,
    }
  })
}

export function funnelToAiPayload(f: FunnelResult, tabTitle: string) {
  return {
    tabTitle: tabTitle.trim() || 'Untitled form',
    partialLeads: f.partialLeads,
    biggestDropQuestion: f.topIncrementalDropStep
      ? {
          questionTitle: f.topIncrementalDropStep.label,
          pct: Number(f.topIncrementalDropStep.pct.toFixed(2)),
          fromCount: f.topIncrementalDropStep.fromCount,
        }
      : null,
    questions: f.steps.map((s) => ({
      questionIndex: s.stepIndex,
      questionTitle: s.label,
      completedCount: s.completedCount,
      cumulativeRate: Number(s.cumulativeRate.toFixed(2)),
      incrementalDropPct:
        s.incrementalDropPct === null
          ? null
          : Number(s.incrementalDropPct.toFixed(2)),
    })),
    whereStudentsStopped: whereStudentsStoppedForPayload(f),
  }
}

export type FlowStepAiContext = {
  questionOrder: number
  questionTitle: string
  /** Internal only—do not repeat in prose. */
  req: number
  opt: number
  /** Grouped branching: step complete if any mapped column answered. */
  funnelCompletion?: 'anyOfColumns'
}

/** Question order for the model (aligned with dashboard flow). */
export function flowToAiContext(flowSteps: FlowStep[]): FlowStepAiContext[] {
  return flowSteps.map((s, i) => ({
    questionOrder: i + 1,
    questionTitle: s.label,
    req: s.fields.filter((f) => f.required).length,
    opt: s.fields.filter((f) => !f.required).length,
    ...(s.completionRule === 'anyFilled'
      ? { funnelCompletion: 'anyOfColumns' as const }
      : {}),
  }))
}

/** Split model output into the two text areas. */
export function splitInsightsAndRecommendations(raw: string): {
  insights: string
  recommendations: string
} {
  const trimmed = raw.trim()
  const m = /^RECOMMENDATIONS:\s*/im.exec(trimmed)
  if (!m || m.index === undefined) {
    return { insights: trimmed.trimEnd(), recommendations: '' }
  }
  const insights = trimmed
    .slice(0, m.index)
    .replace(/^INSIGHTS:\s*/i, '')
    .trimEnd()
  const recommendations = trimmed.slice(m.index + m[0].length).trimEnd()
  return { insights, recommendations }
}

type GeminiPart = { text?: string }
type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; code?: number }
}

function extractGeminiText(data: GeminiResponse): string {
  if (data.error?.message) {
    throw new Error(data.error.message)
  }
  const block = data.promptFeedback?.blockReason
  if (block) {
    throw new Error(`Gemini blocked the prompt (${block}). Try editing the flow or shortening labels.`)
  }
  const parts = data.candidates?.[0]?.content?.parts
  const text = parts?.map((p) => p.text ?? '').join('').trim()
  if (text) return text
  const fr = data.candidates?.[0]?.finishReason
  throw new Error(
    fr
      ? `No text in response (finishReason: ${fr}).`
      : 'Empty response from Gemini.'
  )
}

type GeminiGenerateOptions = {
  /** Use this model id instead of settings / env default. */
  model?: string
  /** Abort each HTTP attempt after this many ms (triggers fast fallback for insights). */
  perRequestTimeoutMs?: number
  /** Retry loop for 429/503 etc. Default 5. */
  maxAttempts?: number
}

async function geminiGenerate(
  settings: AiInsightsSettings,
  systemInstruction: string,
  userText: string,
  temperature: number,
  options?: GeminiGenerateOptions
): Promise<string> {
  const baseRaw = resolveBaseUrl(settings.baseUrl)
  const model = resolveGeminiModel(settings, options?.model)
  const clientKey = settings.apiKey.trim()

  const path = `v1beta/models/${model}:generateContent`
  let url: string
  if (baseRaw.startsWith('/')) {
    url = `${baseRaw.replace(/\/$/, '')}/${path}`
  } else {
    url = `${baseRaw.replace(/\/$/, '')}/${path}`
  }

  const qs: string[] = []
  if (clientKey) {
    qs.push(`key=${encodeURIComponent(clientKey)}`)
  } else if (!baseRaw.startsWith('/')) {
    throw new Error(
      'Add your Gemini API key, or use a same-origin base URL (e.g. /api/gemini in dev with GEMINI_API_KEY in .env.local).'
    )
  }
  if (qs.length) {
    url += (url.includes('?') ? '&' : '?') + qs.join('&')
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature },
  })

  const maxAttempts = options?.maxAttempts ?? 5
  const perMs = options?.perRequestTimeoutMs
  let lastMessage = 'Gemini request failed.'

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctrl = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (perMs != null && perMs > 0) {
      timeoutId = setTimeout(() => ctrl.abort(), perMs)
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      })
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId)
      if (isAbortError(err)) {
        throw new GeminiTimeoutError(
          `No response from ${model} within ${perMs}ms.`,
          model
        )
      }
      throw err
    }
    if (timeoutId) clearTimeout(timeoutId)

    const data = (await res.json()) as GeminiResponse
    lastMessage =
      data.error?.message ||
      `Gemini request failed (${res.status}). For browser CORS issues, use base URL /api/gemini behind a proxy.`

    const apiError = Boolean(data.error?.message)
    if (res.ok && !apiError) {
      return extractGeminiText(data)
    }

    const overloadOrCapacity =
      /high demand|temporarily unavailable|try again later|overload|capacity|service unavailable|backend error|unavailable/i.test(
        lastMessage
      )
    const retryable =
      res.status === 429 ||
      res.status === 503 ||
      res.status === 502 ||
      res.status === 529 ||
      /quota|rate limit|resource_exhausted|retry in/i.test(lastMessage) ||
      overloadOrCapacity

    if (retryable && attempt < maxAttempts - 1) {
      const fromApi = parseRetryAfterSeconds(lastMessage)
      const waitSec =
        fromApi ??
        (overloadOrCapacity
          ? Math.min(45, 6 + attempt * 8)
          : (attempt + 1) * 5)
      await sleep(Math.min(waitSec * 1000 + 300, 90_000))
      continue
    }

    const hint = overloadOrCapacity
      ? '\n\nTip: Usually Google-side capacity, not your quota. Retry in a few minutes or set VITE_GEMINI_INSIGHTS_LITE_MODEL (or FALLBACK) to another listed model in .env.local / Vercel.'
      : ''
    throw new Error(lastMessage + hint)
  }

  throw new Error(lastMessage)
}

export type GenerateFillFromMetricsOptions = {
  /** Use only Flash Lite with extra retries (e.g. after quota—skip Flash upgrade on timeout). */
  forceLiteModel?: boolean
}

/** Two insights + two recommendations for “Fill from metrics”. */
export async function generateFillFromMetricsAi(
  funnel: FunnelResult,
  tabTitle: string,
  settings: AiInsightsSettings,
  flowSteps: FlowStep[] = [],
  opts?: GenerateFillFromMetricsOptions
): Promise<{ insights: string; recommendations: string }> {
  const payload = funnelToAiPayload(funnel, tabTitle)
  const flowContext = flowToAiContext(flowSteps)
  const flowBlock =
    flowContext.length > 0
      ? `

${FORM_FLOW_LEGEND}
formFlow:
${JSON.stringify(flowContext)}`
      : `

formFlow omitted—infer only from metrics questions[].questionTitle.`

  const userContent = `Audience: VP / CMO / enrollment director.

FORM CONTEXT (treat as given)
- Contact/personal info is already at the end of this form. Do not advise moving it to the end as a recommendation.
- Splitting contact fields across two pages was tested and did not help; do not recommend that.

Use the metrics JSON. Use formFlow for question themes (program, eligibility, contact)—do not invent steps not in the data.

DATA CHEAT SHEET
- completedCount: leads who cleared this question and all prior questions in order.
- "${REACH_CHART_SECTION_TITLE}": questions[].cumulativeRate vs partialLeads.
- "${DROP_CHART_SECTION_TITLE}": whereStudentsStopped[]. stoppedPctOfPartialLeads uses partialLeads as denominator. ${DROP_CHART_HINT} isHighlightedOnWhereStudentsStoppedChart = true on the step with the largest incremental drop (same as biggestDropQuestion when present), not necessarily max stoppedCount.
- biggestDropQuestion: largest step-to-step incremental drop (different math than stopped chart)—do not mix the two % types.

INSIGHTS — 2 bullets
- Bullet 1: Sharpest cumulative/reach story—numbers must match questions[].cumulativeRate / completedCount vs partialLeads (same as "${REACH_CHART_SECTION_TITLE}" chart).
- Bullet 2: Sharpest drop/stopped story—tie to whereStudentsStopped[]; the **highlighted** bar = isHighlightedOnWhereStudentsStoppedChart (use that row’s stoppedCount and stoppedPctOfPartialLeads). For “most raw stops,” use max stoppedCount if it differs. Stay concise; optional short why.
- Verify: no wrong question title for the highlighted incremental-drop question, no swapped percentages between stoppedPctOfPartialLeads and incrementalDropPct / biggestDropQuestion.

RECOMMENDATIONS — 2 bullets
- Each bullet = one concrete recommendation. It may target a single question (copy, options, order) or the **whole form** (general patterns: tone, opening, consistency, pacing between sections)—still actionable, not vague. Do not split contact across pages.
- When it helps, end with a short "Example: …" (revised question, options, or helper text only if that is truly the fix—keep it brief).
- Adding help text is not always the answer for better completion; vary tactics (question length, choice count/labels, required vs optional, trust copy)—avoid recommending helper text for both bullets by default.
- Program of interest / major–style questions: adding an Unsure or Undecided choice is often effective when relevant—mention if the funnel points at that kind of question.
- Contact is already last; focus friction fixes on wording, trust, optional/required clarity—not structure experiments already ruled out (two-page contact).
- Never recommend putting contact first, moving the contact block earlier, or splitting name/email/phone across separate pages.
- Do not suggest: mobile optimization, progress bars, or step counters.

${flowBlock}

metrics:
${JSON.stringify(payload)}

Write exactly this shape:
INSIGHTS:
• ...
• ...
RECOMMENDATIONS:
• ... (optional: Example: …)
• ... (optional: Example: …)`

  const primaryModel = resolveGeminiModel(settings)

  if (opts?.forceLiteModel) {
    const text = await geminiGenerate(
      settings,
      FILL_FROM_METRICS_SYSTEM,
      userContent,
      0.25,
      {
        model: INSIGHTS_LITE_MODEL,
        maxAttempts: 5,
        perRequestTimeoutMs:
          INSIGHTS_FALLBACK_TIMEOUT_MS > 0 ? INSIGHTS_FALLBACK_TIMEOUT_MS : undefined,
      }
    )
    return splitInsightsAndRecommendations(text)
  }

  // Lite first: each attempt aborts after INSIGHTS_PRIMARY_TIMEOUT_MS; retries on same model for 429/503. On timeout → INSIGHTS_FALLBACK_MODEL (Flash) with full retries.

  try {
    const text = await geminiGenerate(
      settings,
      FILL_FROM_METRICS_SYSTEM,
      userContent,
      0.25,
      {
        perRequestTimeoutMs: INSIGHTS_PRIMARY_TIMEOUT_MS,
        maxAttempts: 2,
      }
    )
    return splitInsightsAndRecommendations(text)
  } catch (e) {
    if (!(e instanceof GeminiTimeoutError) || shouldSkipModelFallback(primaryModel)) {
      throw e
    }
    const text = await geminiGenerate(
      settings,
      FILL_FROM_METRICS_SYSTEM,
      userContent,
      0.25,
      {
        model: INSIGHTS_FALLBACK_MODEL,
        maxAttempts: 5,
        perRequestTimeoutMs:
          INSIGHTS_FALLBACK_TIMEOUT_MS > 0 ? INSIGHTS_FALLBACK_TIMEOUT_MS : undefined,
      }
    )
    return splitInsightsAndRecommendations(text)
  }
}
