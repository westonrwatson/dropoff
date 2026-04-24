import JSZip from 'jszip'
import type { FieldBinding, FlowStep } from '../types'
import { newId } from './id'

/** Columns we avoid auto-mapping (tracking / meta). */
const META_HEADER =
  /^(date|first name|last name|email|submission|lead profile|ai form|variant|equation|utm|gclid|fbclid|ip address|browser|device|url|host|calling|city|zip|state|country|stage|source|recommendation|phone)/i

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
}

function docxXmlToPlain(xml: string): string {
  let t = xml.replace(/<w:tab[^>]*\/>/gi, ' ')
  /** Table cells as separate lines so “Option Response” choices list cleanly. */
  t = t.replace(/<\/w:tc>/gi, '\n')
  t = t.replace(/<\/w:tr>/gi, '\n')
  t = t.replace(/<\/w:p>/gi, '\n')
  t = t.replace(/<[^>]+>/g, ' ')
  t = decodeXmlEntities(t)
  /** Keep paragraph breaks so “Skip if … is one of the following:” option lines stay split. */
  t = t.replace(/[ \t\u00a0]+/g, ' ')
  t = t.replace(/\n[ \t\u00a0]*/g, '\n')
  t = t.replace(/[ \t\u00a0]*\n/g, '\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeKey(s)
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

/** When the review question matches, boost headers whose normalized form contains these phrases. */
const QUESTION_HEADER_HINTS: { re: RegExp; headerNeedles: string[] }[] = [
  {
    re: /anticipated major|program of interest/i,
    headerNeedles: ['program of interest', 'program interest'],
  },
  {
    re: /sport of interest|your sport/i,
    headerNeedles: ['sport of interest', 'sport'],
  },
  {
    re: /connected with our coach|been connected/i,
    headerNeedles: ['contact with coach', 'coach'],
  },
  {
    re: /when would you like your program to start|program to start/i,
    headerNeedles: [
      'program start',
      'start date',
      'start season',
      'start term',
      'start year',
    ],
  },
  {
    re: /excites you.*earning your degree online|excitement/i,
    headerNeedles: ['excitement', 'earning degree online'],
  },
  {
    re: /concerns you about studying online|studying online/i,
    headerNeedles: ['concerns about studying', 'studying online'],
  },
  {
    re: /concerns you about|biggest concern/i,
    headerNeedles: ['concerns about attending', 'biggest concern'],
  },
  {
    re: /motivates you most to attend/i,
    headerNeedles: ['motivation to attend'],
  },
  {
    re: /motivates you to complete/i,
    headerNeedles: ['motivation to complete'],
  },
  {
    re: /type of student/i,
    headerNeedles: ['type of student', 'student type'],
  },
  {
    re: /area are you interested in|online area/i,
    headerNeedles: ['online area', 'area of interest'],
  },
  {
    re: /^email address$/i,
    headerNeedles: ['email'],
  },
  {
    re: /phone number/i,
    headerNeedles: ['phone'],
  },
  {
    re: /^first name$/i,
    headerNeedles: ['first name'],
  },
  {
    re: /^last name$/i,
    headerNeedles: ['last name'],
  },
]

function isLikelyFormColumn(header: string): boolean {
  const t = header.trim()
  if (t.length < 2 || t.length > 200) return false
  if (META_HEADER.test(t)) {
    // Allow "What is your phone number?" style — not bare "Phone" meta row
    if (!/\?/.test(t) && /^(email|first name|last name)$/i.test(t)) return true
    if (normalizeKey(t).includes('phone') && t.includes('?')) return true
    return false
  }
  return true
}

function scoreMatch(question: string, header: string): number {
  if (!isLikelyFormColumn(header)) return -1
  const qt = tokens(question)
  const htokens = normalizeKey(header).split(/\s+/).filter((w) => w.length > 2)
  let shared = 0
  for (const w of htokens) {
    if (qt.has(w)) shared++
  }
  const denom = Math.max(1, Math.min(qt.size, htokens.length))
  let score = (shared / denom) * 12 + shared * 1.2

  const qn = normalizeKey(question)
  const hn = normalizeKey(header)
  if (qn.length >= 4 && hn.length >= 4) {
    if (qn.includes(hn) || hn.includes(qn)) score += 14
  }

  for (const { re, headerNeedles } of QUESTION_HEADER_HINTS) {
    if (re.test(question)) {
      for (const needle of headerNeedles) {
        const nn = normalizeKey(needle)
        if (nn && hn.includes(nn)) score += 16
      }
    }
  }
  return score
}

type HeaderPickContext = {
  answerOptions?: string[]
  rows?: Record<string, string>[]
}

function optionCsvOverlapBoost(
  opts: string[],
  header: string,
  rows: Record<string, string>[]
): number {
  let hits = 0
  const seen = new Set<string>()
  const samples: string[] = []
  for (const r of rows.slice(0, 500)) {
    const v = String(r[header] ?? '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    samples.push(v)
    if (samples.length >= 250) break
  }
  if (samples.length === 0) return 0
  const normSamples = samples.map((s) => normalizeKey(s))
  for (const o of opts.slice(0, 30)) {
    const on = normalizeKey(o)
    if (on.length < 3) continue
    if (
      normSamples.some(
        (s) => s === on || s.includes(on) || on.includes(s)
      )
    ) {
      hits++
    }
  }
  return Math.min(40, hits * 8)
}

/** Disambiguate duplicate review questions (e.g. two “anticipated major” picklists). */
function answerOptionsHeaderBoost(
  question: string,
  header: string,
  ctx?: HeaderPickContext
): number {
  if (!ctx?.answerOptions?.length) return 0
  let b = 0
  const hn = header.toLowerCase()
  const optBlob = ctx.answerOptions.slice(0, 40).join(' ').toLowerCase()
  const mentionsGrad =
    /\bmba\b|master of arts|master of science|m\.s\.|m\.a\.|doctoral|edd\b/i.test(
      optBlob
    )
  const mentionsUgrad =
    /\baccounting\b|\bbiochemistry\b|\bundecided\b|\bbsn\b|rn to bsn|bachelor|elementary education/i.test(
      optBlob
    )
  if (/anticipated\s+major|program\s+of\s+interest/i.test(question)) {
    if (mentionsGrad) {
      if (/graduate|grad |master|mba|post.?grad|second degree/i.test(hn)) b += 30
      if (
        /program of interest|anticipated|major/.test(hn) &&
        !/graduate|master|mba/.test(hn)
      )
        b -= 10
    }
    if (mentionsUgrad && !mentionsGrad) {
      if (
        /program of interest|anticipated|major|undergrad|interest/i.test(hn) &&
        !/graduate|master|mba/.test(hn)
      )
        b += 26
      if (/graduate|master|mba/.test(hn)) b -= 14
    }
  }
  if (ctx.rows?.length) {
    b += optionCsvOverlapBoost(ctx.answerOptions, header, ctx.rows)
  }
  return b
}

function cutQuestionBody(raw: string): { text: string; required: boolean } {
  let t = raw
  /** Many Halda reviews omit `OptionResponse`; options are glued right after `(required)`. */
  const reqBlock = t.match(/^(.*?)(\?)?\s*\(required\)/i)
  if (reqBlock) {
    let body = reqBlock[1]!.trim()
    const hadQ = Boolean(reqBlock[2])
    if (hadQ) body += '?'
    else if (!body.endsWith('?')) body += '?'
    return { text: decodeXmlEntities(body), required: true }
  }

  const cutters: RegExp[] = [
    /\s*\(required\)\s*OptionResponse/i,
    /\s*OptionResponse/i,
    /\s*Screen:\s*\d+/i,
    /\s*Skip if question/i,
    /\s*Question:/i,
    /\s*Response Page/i,
    /\s*Instructions:/i,
    /\s*AI Generated/i,
  ]
  let end = t.length
  for (const re of cutters) {
    const m = re.exec(t)
    if (m && m.index !== undefined && m.index < end) end = m.index
  }
  t = t.slice(0, end).trim()
  t = t.replace(/\s*\(required\)\s*$/i, '').trim()
  t = decodeXmlEntities(t)
  return { text: t, required: false }
}

function screenNumberFromPrefix(prefix: string): number | undefined {
  const matches = [...prefix.matchAll(/Screen:\s*(\d+)/gi)]
  if (matches.length === 0) return undefined
  return Number(matches[matches.length - 1]![1])
}

/**
 * Lines after “Option Response” in a review chunk (Halda tables → newlines in plain text).
 */
function extractAnswerOptionsFromChunk(chunk: string): string[] | undefined {
  const m = /\bOption\s+Response\b/i.exec(chunk)
  if (!m || m.index === undefined) return undefined
  let rest = chunk.slice(m.index + m[0].length).trimStart()
  const stopRe =
    /(?:^|\n)\s*Screen:\s*\d+|(?:^|\n)\s*Skip\s+if\s+question|\bResponse\s+Page\b|\bAI\s+Generated\b|(?:^|\n)\s*Question:\s*/i
  const sm = stopRe.exec(rest)
  if (sm && sm.index !== undefined && sm.index > 0) {
    rest = rest.slice(0, sm.index)
  } else if (sm?.index === 0) {
    rest = ''
  }
  const lines = rest
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const drop = new Set([
    'option',
    'response',
    'option response',
    '(select one)',
    '(select all that apply)',
  ])
  const out = lines.filter((l) => {
    const k = l.replace(/\s+/g, ' ').toLowerCase()
    return !drop.has(k) && k.length > 0
  })
  return out.length > 0 ? out : undefined
}

/** True when this line is likely the next review question (after skip-option lines). */
function looksLikeFollowingQuestionLine(line: string): boolean {
  const t = line.trim()
  if (t.length < 12) return false
  if (/^screen:\s*\d/i.test(t)) return false
  if (/^skip\s+if\s/i.test(t)) return false
  if (/^is\s+one\s+of\s+the\s+following/i.test(t)) return false
  return /\?\s*(\(required\))?\s*$/i.test(t)
}

/** Remove Halda “Skip if question … is one of the following:” block so question body parses cleanly. */
function stripSkipIfBlock(chunk: string): string {
  const re =
    /Skip\s+if\s+question\s+([\s\S]+?)\s+is\s+one\s+of\s+the\s+following:\s*/i
  const m = re.exec(chunk)
  if (!m || m.index === undefined) {
    return chunk
  }
  const start = m.index
  let cursor = start + m[0].length
  const skipLines: string[] = []

  while (cursor < chunk.length) {
    const nl = chunk.indexOf('\n', cursor)
    const lineRaw = nl === -1 ? chunk.slice(cursor) : chunk.slice(cursor, nl)
    const lineEnd = nl === -1 ? chunk.length : nl + 1
    const t = lineRaw.trim()

    if (!t) {
      if (skipLines.length > 0) break
      cursor = lineEnd
      continue
    }
    if (/^question:\s*/i.test(t)) break
    if (looksLikeFollowingQuestionLine(t)) break

    skipLines.push(t)
    cursor = lineEnd
  }

  return `${chunk.slice(0, start)}\n${chunk.slice(cursor)}`
}

/** Strip Halda “only shown to …” lines and return the audience phrase for branching. */
function extractShowOnlyAudience(chunk: string): {
  audience: string | undefined
  chunkWithoutLines: string
} {
  let stripped = chunk
  let audience: string | undefined
  const patterns: RegExp[] = [
    /this\s+question\s+is\s+only\s+shown\s+to\s+(.+?)(?=\n|$)/gi,
    /this\s+question\s+is\s+only\s+shown\s+for\s+(.+?)(?=\n|$)/gi,
    /only\s+shown\s+to\s+(.+?)(?=\n|$)/gi,
    /shown\s+only\s+to\s+(.+?)(?=\n|$)/gi,
    /skip\s+logic:?\s*only\s+show\s+(?:if|when)\s+(.+?)(?=\n|$)/gi,
  ]
  for (const re of patterns) {
    const rx = new RegExp(re.source, re.flags)
    stripped = stripped.replace(rx, (_m, g1: string) => {
      const t = g1.trim().replace(/\s+/g, ' ')
      if (t && !audience) audience = t
      return '\n'
    })
  }
  return { audience, chunkWithoutLines: stripped }
}

export type QuestionWithRequired = {
  text: string
  required: boolean
  /** Screen: N from the review (funnel order). */
  reviewScreen?: number
  /** Multiple choice / picklist labels from the review. */
  answerOptions?: string[]
}

export function extractReviewQuestions(plain: string): QuestionWithRequired[] {
  const chunks = plain.split(/Question:\s*/i)
  const out: QuestionWithRequired[] = []
  let acc = chunks[0] ?? ''
  for (let i = 1; i < chunks.length; i++) {
    const rawChunk = chunks[i]!
    const reviewScreen = screenNumberFromPrefix(acc)
    acc += `Question:${rawChunk}`
    const w0 = stripSkipIfBlock(rawChunk)
    const { chunkWithoutLines } = extractShowOnlyAudience(w0)
    const answerOptions = extractAnswerOptionsFromChunk(chunkWithoutLines)
    const { text, required } = cutQuestionBody(chunkWithoutLines)
    if (text.length < 3) continue
    if (/^skip if question/i.test(text)) continue
    if (text.length > 220) continue
    if (/AI Generated|Instructions:\s*Generate/i.test(text)) continue
    out.push({
      text,
      required,
      reviewScreen,
      answerOptions,
    })
  }
  return out
}

/** Read a Halda “Review” Word export and return questions in screen order. */
export async function parseHaldaReviewDocx(
  file: File
): Promise<QuestionWithRequired[]> {
  const buf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Not a valid .docx (missing word/document.xml).')
  const xml = await entry.async('string')
  const plain = docxXmlToPlain(xml)
  return extractReviewQuestions(plain)
}

const MIN_SCORE = 5.5

type MatchedPair = {
  question: string
  header: string
  required: boolean
  reviewScreen?: number
  answerOptions?: string[]
}

function bestHeaderForQuestion(
  question: string,
  headers: string[],
  used: Set<string>,
  ctx?: HeaderPickContext
): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const h of headers) {
    if (used.has(h)) continue
    const s = scoreMatch(question, h)
    if (s < 0) continue
    const adj = s + answerOptionsHeaderBoost(question, h, ctx)
    if (adj > bestScore) {
      bestScore = adj
      best = h
    }
  }
  if (bestScore < MIN_SCORE || !best) return null
  return best
}

function isContactHeader(header: string): boolean {
  const n = normalizeKey(header)
  return (
    n === 'email' ||
    n === 'first name' ||
    n === 'last name' ||
    n.includes('phone')
  )
}

/**
 * Map Halda review export order → flow steps + CSV columns (dedupe columns, merge contact run).
 * Pass `rows` when available so duplicate question titles map to distinct CSV columns using values.
 */
export function buildFlowFromReviewQuestions(
  questions: QuestionWithRequired[],
  headers: string[],
  rows?: Record<string, string>[]
): FlowStep[] {
  const used = new Set<string>()
  const pairs: MatchedPair[] = []

  for (const { text, required, reviewScreen, answerOptions } of questions) {
    const ctx: HeaderPickContext | undefined =
      answerOptions?.length || rows?.length
        ? { answerOptions, rows }
        : undefined
    const header = bestHeaderForQuestion(text, headers, used, ctx)
    if (!header) continue
    used.add(header)
    pairs.push({
      question: text,
      header,
      required,
      reviewScreen,
      answerOptions,
    })
  }

  const stepsOut: FlowStep[] = []
  let i = 0
  while (i < pairs.length) {
    if (isContactHeader(pairs[i]!.header)) {
      const run: MatchedPair[] = []
      while (i < pairs.length && isContactHeader(pairs[i]!.header)) {
        run.push(pairs[i]!)
        i++
      }
      if (run.length === 1) {
        stepsOut.push(singleStep(run[0]!))
      } else {
        stepsOut.push({
          id: newId(),
          label: 'Contact information',
          fields: run.map(
            (p): FieldBinding => ({
              id: newId(),
              column: p.header,
              required: p.required,
            })
          ),
        })
      }
    } else {
      const p = pairs[i]!
      stepsOut.push(singleStep(p))
      i++
    }
  }

  return stepsOut
}

/** Strip Halda review boilerplate like `_(Select all that apply)_` from step titles. */
export function sanitizeReviewStepTitle(raw: string): string {
  let t = raw.replace(/_\s*\(\s*Select all that apply\s*\)\s*_/gi, ' ')
  t = t.replace(/\(\s*Select all that apply\s*\)/gi, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

const PROGRAM_START_HEADER = /program\s*start/i
const PROGRAM_START_QUESTION =
  /program\s*start\s*season|program\s*start\s*term|program\s*start\s*year|program\s*start\s*date|when\s+would\s+you\s+like\s+your\s+program\s+to\s+start|when\s+.*\s+your\s+program\s+to\s+start/i

function programStartStepLabel(p: MatchedPair): string | null {
  if (PROGRAM_START_HEADER.test(p.header)) return 'Program Start'
  if (PROGRAM_START_QUESTION.test(p.question)) return 'Program Start'
  return null
}

function titleCaseWord(w: string): string {
  if (!w) return ''
  const lower = w.toLowerCase()
  if (lower === 'gpa') return 'GPA'
  if (lower === 'mba') return 'MBA'
  if (lower === 'rn' || lower === 'bsn') return w.toUpperCase()
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

type StepLabelRule = { re: RegExp; label: string }

/** Longer / more specific patterns first. */
const STEP_LABEL_RULES: StepLabelRule[] = [
  {
    re: /^what\s+concerns\s+you\b/i,
    label: 'Concerns',
  },
  {
    re: /^what\s+excites\s+you\b/i,
    label: 'Excitement',
  },
  {
    re: /^what\s+motivates\s+you\s+most\s+to\s+attend/i,
    label: 'Motivation',
  },
  {
    re: /^what\s+motivates\s+you\s+to\s+complete/i,
    label: 'Motivation',
  },
  {
    re: /^what\s+is\s+your\s+biggest\s+concern/i,
    label: 'Concerns',
  },
  {
    re: /^what\s+is\s+your\s+anticipated\s+major/i,
    label: 'Program of Interest',
  },
  {
    re: /^what\s+is\s+your\s+program\s+of\s+interest/i,
    label: 'Program',
  },
  {
    re: /^what\s+is\s+your\s+sport/i,
    label: 'Sport',
  },
  {
    re: /^what\s+type\s+of\s+student\s+are\s+you/i,
    label: 'Student type',
  },
  {
    re: /^have\s+you\s+already\s+been\s+connected.*coach/i,
    label: 'Coach',
  },
  {
    re: /^what\s+area\s+are\s+you\s+interested\s+in/i,
    label: 'Area',
  },
  {
    re: /^what\s+is\s+your\s+online\s+area/i,
    label: 'Area',
  },
  {
    re: /^email\s+address/i,
    label: 'Email',
  },
  {
    re: /^what\s+is\s+your\s+phone/i,
    label: 'Phone',
  },
  {
    re: /^phone\s+number/i,
    label: 'Phone',
  },
  {
    re: /^first\s+name/i,
    label: 'First name',
  },
  {
    re: /^last\s+name/i,
    label: 'Last name',
  },
  {
    re: /^do\s+you\s+report/i,
    label: 'Test scores',
  },
  {
    re: /^is\s+u\.?s\.?\s+citizen/i,
    label: 'Citizenship',
  },
]

const SKIP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'in',
  'to',
  'and',
  'or',
  'your',
  'my',
  'any',
])

/**
 * Turn a Halda review question into a short funnel step title (e.g. “Program of Interest”, “Concerns”).
 */
export function abbreviateReviewQuestionToStepLabel(raw: string): string {
  const q = sanitizeReviewStepTitle(raw).replace(/\?+$/g, '').trim()
  if (!q) return 'Question'

  const wordCount = q.split(/\s+/).filter(Boolean).length
  if (wordCount <= 3) return q

  for (const { re, label } of STEP_LABEL_RULES) {
    if (re.test(q)) return label
  }

  let m = q.match(/^what\s+is\s+your\s+(.+)$/i)
  if (m) {
    const words = m[1]!.trim().split(/\s+/).filter(Boolean)
    const sig = words.filter((w) => !SKIP_WORDS.has(w.toLowerCase()))
    const last = sig[sig.length - 1]
    if (last) return titleCaseWord(last)
  }

  m = q.match(/^what\s+are\s+your\s+(.+)$/i)
  if (m) {
    const words = m[1]!.trim().split(/\s+/).filter(Boolean)
    const sig = words.filter((w) => !SKIP_WORDS.has(w.toLowerCase()))
    const last = sig[sig.length - 1]
    if (last) return titleCaseWord(last)
  }

  m = q.match(/^what\s+(\w+)\s+do\s+you/i)
  if (m) return titleCaseWord(m[1]!)

  m = q.match(/^how\s+did\s+you\s+hear/i)
  if (m) return 'Source'

  const parts = q.split(/\s+/).filter(Boolean).slice(0, 4)
  let s = parts.map(titleCaseWord).join(' ')
  if (s.length > 36) s = `${s.slice(0, 33)}…`
  return s || 'Question'
}

function singleStep(p: MatchedPair): FlowStep {
  const label =
    programStartStepLabel(p) ?? abbreviateReviewQuestionToStepLabel(p.question)
  const display = label.length > 48 ? `${label.slice(0, 45)}…` : label
  return {
    id: newId(),
    label: display,
    fields: [
      {
        id: newId(),
        column: p.header,
        required: p.required,
      },
    ],
  }
}
