import Papa from 'papaparse'
import { DEFAULT_META, type ParsedDataset } from '../types'

export function parseCSVFile(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const headers = results.meta.fields?.filter(Boolean) as string[]
        if (!headers?.length) {
          reject(new Error('No columns found in CSV'))
          return
        }
        const rows = results.data.filter((row) =>
          headers.some((h) => String(row[h] ?? '').trim() !== '')
        )
        resolve({ headers, rows })
      },
      error: (err) => reject(err),
    })
  })
}

export function parseCSVString(text: string): ParsedDataset {
  const results = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  })
  const headers = results.meta.fields?.filter(Boolean) as string[]
  if (!headers?.length) {
    throw new Error('No columns found in CSV')
  }
  const rows = results.data.filter((row) =>
    headers.some((h) => String(row[h] ?? '').trim() !== '')
  )
  return { headers, rows }
}

export function distinctValues(
  rows: Record<string, string>[],
  column: string
): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const v = String(row[column] ?? '').trim()
    if (v) set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Pick variant column (Variant Name or first header matching /variant/i) and first distinct value. */
export function inferVariantFromDataset(d: ParsedDataset): {
  variantColumn: string
  variantValue: string
} {
  const { headers, rows } = d
  let col = ''
  if (headers.includes(DEFAULT_META.variant)) {
    col = DEFAULT_META.variant
  } else {
    const found = headers.find((h) => /variant/i.test(h))
    if (found) col = found
  }
  if (!col) return { variantColumn: '', variantValue: '' }
  const vals = distinctValues(rows, col)
  if (vals.length === 0) return { variantColumn: col, variantValue: '' }
  return { variantColumn: col, variantValue: vals[0]! }
}

export function mergeDatasets(datasets: ParsedDataset[]): ParsedDataset {
  if (datasets.length === 0) throw new Error('No datasets to merge')
  if (datasets.length === 1) return datasets[0]!
  const headers = datasets[0]!.headers
  const rows = datasets.flatMap((d) => d.rows)
  return { headers, rows }
}

export function datasetToCsvText(dataset: ParsedDataset): string {
  const { headers, rows } = dataset
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const v = String(row[h] ?? '')
          if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
          return v
        })
        .join(',')
    ),
  ]
  return lines.join('\n')
}

/** Prefer known export columns, else first header that looks date-like. */
export function pickFreshnessColumn(headers: string[]): string | null {
  const prefer = [
    'Date and Time Created',
    'Submission Date',
    'Submission Time',
  ]
  for (const h of prefer) {
    if (headers.includes(h)) return h
  }
  const hit = headers.find((h) => /date|created|timestamp/i.test(h))
  return hit ?? null
}

export function maxDateInColumn(
  rows: Record<string, string>[],
  column: string
): string | null {
  let best: number | null = null
  for (const row of rows) {
    const raw = String(row[column] ?? '').trim()
    if (!raw) continue
    const t = Date.parse(raw)
    if (!Number.isNaN(t) && (best === null || t > best)) best = t
  }
  if (best === null) return null
  return new Date(best).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const AI_FORM_COL = 'AI Form Name'
const HOST_COL = 'Host URL'
const URL_COL = 'URL'

function firstNonEmptyColumn(
  rows: Record<string, string>[],
  column: string
): string {
  for (const row of rows) {
    const v = String(row[column] ?? '').trim()
    if (v) return v
  }
  return ''
}

function hostnameFromFullUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    return u.hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** Readable default from a host or bare domain (e.g. `rollins.edu` → `Rollins.edu`). */
export function displayNameFromHost(hostRaw: string): string {
  const h = hostRaw.trim()
  if (!h) return ''
  return h.charAt(0).toUpperCase() + h.slice(1).toLowerCase()
}

const PERSONAL_EMAIL_ROOTS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
])

function isPersonalOrConsumerMailHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^www\./, '')
  if (!h) return true
  if (PERSONAL_EMAIL_ROOTS.has(h)) return true
  const parts = h.split('.')
  if (parts.length >= 2) {
    const root2 = parts.slice(-2).join('.')
    if (PERSONAL_EMAIL_ROOTS.has(root2)) return true
  }
  return false
}

/** Vendors / tools — not the school’s primary site (and often appear in URL column). */
const THIRD_PARTY_HOST_RE =
  /(?:^|\.)(?:google|gstatic|googleusercontent|doubleclick|facebook|fbcdn|linkedin|twitter|twimg|instagram|tiktok|halda|hubspot|hsforms|hs-sites|salesforce|force\.com|marketo|pardot|typeform|surveymonkey|wufoo|cognitoforms|jotform|zendesk|intercom|drift|calendly)(?:\.|$)/i

/**
 * True if `host` is safe to show as the school line (we never use the Email column).
 * Rejects consumer mail domains and common third-party / form vendors.
 */
export function isPlausibleSchoolSiteHost(hostRaw: string): boolean {
  const h = hostRaw.trim().toLowerCase().replace(/^www\./, '')
  if (!h || !h.includes('.')) return false
  if (isPersonalOrConsumerMailHost(h)) return false
  if (THIRD_PARTY_HOST_RE.test(h)) return false

  if (/\.edu$/i.test(h)) return true
  if (/\.ac\.uk$/i.test(h) || /\.sch\.uk$/i.test(h)) return true
  if (/\.edu\.au$/i.test(h)) return true
  if (/\.gc\.ca$/i.test(h)) return true
  if (/\.k12\./i.test(h)) return true

  // .org / .com / .net / international — allowed if not blocklisted above
  return true
}

/** Normalize Host URL cell (bare `school.edu` or full URL) to hostname. */
function canonicalHostnameFromHostField(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return hostnameFromFullUrl(s)
  return s.replace(/^www\./i, '').split('/')[0]!.trim()
}

/**
 * `HALDA_graduate_personalized_plan_04-09-26-18_03_04.csv` → `Graduate Personalized Plan`
 * Strips from the first `_MM-DD-YY` (export timestamp) segment onward.
 */
export function inferFormTitleFromHaldaFilename(filename: string): string {
  const base = filename.replace(/\.csv$/i, '').trim()
  if (!/^halda_/i.test(base)) return ''
  const rest = base.replace(/^halda_/i, '')
  const m = rest.match(/^(.+?)_\d{2}-\d{2}-\d{2}/)
  const slug = (m ? m[1]! : rest).replace(/_+$/, '')
  if (!slug) return ''
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export type InferredExportLabels = {
  /** Tab / form label */
  formTitle: string
  /** School line in header (from host, user-editable) */
  schoolName: string
}

/**
 * Prefer CSV columns (`AI Form Name`, `Host URL`, `URL`), then HALDA-style filename.
 * School name is never taken from the Email column; hostnames must pass
 * `isPlausibleSchoolSiteHost` so consumer mail / vendor domains are skipped.
 */
export function inferExportLabels(
  d: ParsedDataset,
  csvFileNames: string[]
): InferredExportLabels {
  const { headers, rows } = d

  let formTitle = ''
  if (headers.includes(AI_FORM_COL)) {
    formTitle = firstNonEmptyColumn(rows, AI_FORM_COL)
  }

  let schoolName = ''
  if (headers.includes(HOST_COL)) {
    const rawHost = firstNonEmptyColumn(rows, HOST_COL)
    const host = canonicalHostnameFromHostField(rawHost)
    if (host && isPlausibleSchoolSiteHost(host)) {
      schoolName = displayNameFromHost(host)
    }
  }
  if (!schoolName && headers.includes(URL_COL)) {
    for (const row of rows) {
      const host = hostnameFromFullUrl(String(row[URL_COL] ?? ''))
      if (host && isPlausibleSchoolSiteHost(host)) {
        schoolName = displayNameFromHost(host)
        break
      }
    }
  }

  if (!formTitle) {
    for (const name of csvFileNames) {
      const t = inferFormTitleFromHaldaFilename(name)
      if (t) {
        formTitle = t
        break
      }
    }
  }

  return { formTitle, schoolName }
}
