import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  DROP_CHART_DESCRIPTION,
  DROP_CHART_HINT,
  DROP_CHART_SECTION_TITLE,
  REACH_CHART_DESCRIPTION,
  REACH_CHART_SECTION_TITLE,
} from './chartSectionCopy'
import { APP_ACCENT_HEX, normalizeHex } from './chartAccent'
import { richTextToPlain } from './richText'

const MARGIN = 14
/** Body line height (mm), tuned for FS_BODY */
const LINE = 5.45
const BULLET_EXTRA_GAP_MM = 3.2

const FS_TITLE = 18
const FS_SECTION = 12
const FS_BODY = 10
const FS_META = 11
const FS_FOOTER = 8
/** Chart section subtitles (reach/drop hints) on PDF — smaller than other section blurbs to save vertical space. */
const FS_CHART_SUBTITLE = 7.25
const CHART_SUBTITLE_LINE_MM = 3.35

/** PDF recommendations callout fill (#F3F4F6) */
const CALLOUT_BG: [number, number, number] = [243, 244, 246]
/** App `--border` */
const CALLOUT_BORDER: [number, number, number] = [231, 229, 228]

/** Footer rule: pad above/below line (mm). Header rule: pad below line before body. */
const RULE_PAD_MM = 2.5
/** Space from last header meta line baseline to header rule (mm). */
const HEADER_GAP_BEFORE_RULE_MM = 2.5
/** Extra space after header rule before the first exported section (insights / charts / table / recs). */
const FIRST_SECTION_TOP_PAD_MM = 2
const RULE_LINE_W_MM = 0.12
const RULE_GRAY: [number, number, number] = [190, 192, 196]

export type PdfExportSelection = {
  includeReachChart: boolean
  includeDropChart: boolean
  includeTable: boolean
  includeInsights: boolean
  includeRecommendations: boolean
}

/** Shown under “Form: …” on PDF covers when funnel data exists. */
export type PdfFunnelCoverStats = {
  partialLeads: number
  largestIncrementalDrop: { pct: number; label: string } | null
}

export type ExportAnalysisPdfOptions = {
  reachChartEl: HTMLElement | null
  dropChartEl: HTMLElement | null
  tableEl: HTMLElement | null
  schoolName: string
  tabTitle: string
  /** Partial leads + largest incremental drop; under form title. */
  funnelCoverStats?: PdfFunnelCoverStats | null
  insightsText: string
  recommendationsText: string
  selection: PdfExportSelection
  /** Match dashboard school accent for headings and section color. */
  accentHex?: string
}

/** Clearance below last KPI baseline before header rule (not a full text line). */
const KPI_BLOCK_TAIL_MM = 1.35

/**
 * Bold `label` + ":" then normal `value` on one line when it fits; otherwise label line then wrapped value.
 */
function drawColonKpiLine(
  pdf: jsPDF,
  y: number,
  boldLabel: string,
  valueText: string,
  maxW: number,
  kpiFont: number,
  kpiLine: number
): number {
  const val = valueText.trim()
  const labelWithColon = `${boldLabel}:`
  pdf.setFontSize(kpiFont)
  pdf.setTextColor(28, 25, 23)

  setPdfHeadingBold(pdf)
  const prefix = `${labelWithColon} `
  const prefixW = pdf.getTextWidth(prefix)
  setPdfFont(pdf, 'normal')
  const singleFits = prefixW + pdf.getTextWidth(val) <= maxW

  if (singleFits) {
    setPdfHeadingBold(pdf)
    pdf.text(prefix, MARGIN, y)
    setPdfFont(pdf, 'normal')
    pdf.text(val, MARGIN + prefixW, y)
    return y + kpiLine
  }

  setPdfHeadingBold(pdf)
  pdf.text(labelWithColon, MARGIN, y)
  let yy = y + kpiLine
  setPdfFont(pdf, 'normal')
  for (const line of pdf.splitTextToSize(val, maxW)) {
    pdf.text(line, MARGIN, yy)
    yy += kpiLine
  }
  return yy
}

/** KPI block under “Form:” — `Label: value` with bold labels to save vertical space on PDF covers. */
function drawFunnelCoverStats(
  pdf: jsPDF,
  y: number,
  stats: PdfFunnelCoverStats
): number {
  const maxW = pdf.internal.pageSize.getWidth() - 2 * MARGIN
  const kpiFont = FS_META - 0.5
  const kpiLine = LINE * 0.88
  y += LINE * 0.35
  y = drawColonKpiLine(
    pdf,
    y,
    'Partial leads',
    stats.partialLeads.toLocaleString('en-US'),
    maxW,
    kpiFont,
    kpiLine
  )
  if (stats.largestIncrementalDrop) {
    const { pct, label } = stats.largestIncrementalDrop
    y = drawColonKpiLine(
      pdf,
      y,
      'Largest incremental drop',
      `${pct.toFixed(1)}% at \u201c${label}\u201d`,
      maxW,
      kpiFont,
      kpiLine
    )
  }
  y += KPI_BLOCK_TAIL_MM
  pdf.setTextColor(0, 0, 0)
  pdf.setFontSize(FS_META)
  setPdfFont(pdf, 'normal')
  return y
}

function safeFilenamePart(s: string): string {
  const x = s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return x || 'report'
}

/** RGB 0–255 for jsPDF */
function parseAccentHex(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '').trim()
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0]!, 16),
      parseInt(h[1]! + h[1]!, 16),
      parseInt(h[2]! + h[2]!, 16),
    ]
  }
  if (h.length === 6 && /^[0-9a-fA-F]+$/.test(h)) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  return [79, 171, 255]
}

/** Cached TTF as base64; null = fetch failed. */
let interFontBase64: string | null | undefined

async function ensureInterFont(pdf: jsPDF): Promise<boolean> {
  if (pdf.getFontList().Inter) return true
  if (interFontBase64 === null) return false
  if (interFontBase64 === undefined) {
    try {
      const res = await fetch(`${window.location.origin}/fonts/InterVariable.ttf`)
      if (!res.ok) {
        interFontBase64 = null
        return false
      }
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!)
      }
      interFontBase64 = btoa(binary)
    } catch {
      interFontBase64 = null
      return false
    }
  }
  try {
    pdf.addFileToVFS('Inter-VF.ttf', interFontBase64)
    pdf.addFont('Inter-VF.ttf', 'Inter', 'normal')
    pdf.addFont('Inter-VF.ttf', 'Inter', 'bold')
    return Boolean(pdf.getFontList().Inter)
  } catch {
    return false
  }
}

function setPdfFont(pdf: jsPDF, style: 'normal' | 'bold') {
  if (pdf.getFontList().Inter) {
    pdf.setFont('Inter', style)
  } else {
    pdf.setFont('helvetica', style)
  }
}

/**
 * PDF headings: Inter VF is registered once for normal+bold but often renders the same
 * weight. Helvetica bold is built in and always reads as bold in viewers.
 */
function setPdfHeadingBold(pdf: jsPDF) {
  pdf.setFont('helvetica', 'bold')
}

function strokeFullWidthRule(pdf: jsPDF, y: number) {
  const w = pdf.internal.pageSize.getWidth()
  pdf.setDrawColor(RULE_GRAY[0], RULE_GRAY[1], RULE_GRAY[2])
  pdf.setLineWidth(RULE_LINE_W_MM)
  pdf.line(MARGIN, y, w - MARGIN, y)
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.2)
}

function ensureY(pdf: jsPDF, y: number, need: number): number {
  const h = pdf.internal.pageSize.getHeight()
  if (y + need > h - MARGIN - 12) {
    pdf.addPage()
    return MARGIN
  }
  return y
}

function addSectionTitle(
  pdf: jsPDF,
  y: number,
  title: string,
  rgb: [number, number, number],
  subtitle?: string | string[],
  opts?: { compactSubtitle?: boolean }
): number {
  const compact = Boolean(opts?.compactSubtitle)
  const gapBefore = compact ? 2.5 : 3.5
  const maxW = pdf.internal.pageSize.getWidth() - 2 * MARGIN
  let yy = ensureY(pdf, y + gapBefore, LINE * 2.2)
  setPdfHeadingBold(pdf)
  pdf.setFontSize(FS_SECTION)
  pdf.setTextColor(rgb[0], rgb[1], rgb[2])
  const titleLines = pdf.splitTextToSize(title, maxW)
  for (const line of titleLines) {
    yy = ensureY(pdf, yy, LINE)
    pdf.text(line, MARGIN, yy)
    yy += LINE
  }
  pdf.setTextColor(0, 0, 0)
  setPdfFont(pdf, 'normal')
  const blocks = subtitle
    ? Array.isArray(subtitle)
      ? subtitle.map((s) => s.trim()).filter(Boolean)
      : subtitle.trim()
        ? [subtitle.trim()]
        : []
    : []
  if (blocks.length > 0) {
    const subSize = compact ? FS_CHART_SUBTITLE : Math.max(8.5, FS_SECTION - 1.5)
    const subLine = compact ? CHART_SUBTITLE_LINE_MM : LINE * 0.95
    pdf.setFontSize(subSize)
    pdf.setTextColor(80, 80, 80)
    for (let i = 0; i < blocks.length; i++) {
      const subLines = pdf.splitTextToSize(blocks[i]!, maxW)
      for (const line of subLines) {
        yy = ensureY(pdf, yy, subLine)
        pdf.text(line, MARGIN, yy)
        yy += subLine
      }
    }
    pdf.setTextColor(0, 0, 0)
    pdf.setFontSize(FS_BODY)
  }
  return yy + (compact ? 1 : 1.75)
}

/** Bullet / numbered line: marker + body. */
function matchBulletLine(line: string): { marker: string; body: string } | null {
  const t = line.trim()
  const m = t.match(/^([•\-\*]|\d+\.)\s+(.+)$/)
  if (!m) return null
  return { marker: m[1]!, body: m[2]!.trim() }
}

function addBody(pdf: jsPDF, y: number, text: string): number {
  const maxW = pdf.internal.pageSize.getWidth() - 2 * MARGIN
  pdf.setFontSize(FS_BODY)
  setPdfFont(pdf, 'normal')
  const body = richTextToPlain(text).trim() || '—'
  const rawLines = body.split(/\r?\n/)
  let yy = y
  let prevWasBullet = false

  for (const raw of rawLines) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      yy += LINE * 0.4
      prevWasBullet = false
      continue
    }

    const trimmed = line.trim()
    const bullet = matchBulletLine(trimmed)

    if (bullet && prevWasBullet) {
      yy += BULLET_EXTRA_GAP_MM
    }

    if (bullet) {
      const full = `${bullet.marker} ${bullet.body}`
      const wrapped = pdf.splitTextToSize(full, maxW - 1)
      for (const wline of wrapped) {
        yy = ensureY(pdf, yy, LINE)
        pdf.text(wline, MARGIN + 0.8, yy)
        yy += LINE
      }
      prevWasBullet = true
    } else {
      const wrapped = pdf.splitTextToSize(trimmed, maxW)
      for (const wline of wrapped) {
        yy = ensureY(pdf, yy, LINE)
        pdf.text(wline, MARGIN, yy)
        yy += LINE
      }
      prevWasBullet = false
    }
  }
  return yy + 2.5
}

/**
 * Split recommendations into callout blocks (paragraphs, or bullet / numbered lines).
 */
function splitRecommendationItems(text: string): string[] {
  const raw = richTextToPlain(text).trim()
  if (!raw) return []
  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length > 1) return paras

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (const line of lines) {
    const m = line.match(/^([•\-\*]|\d+\.)\s+(.+)$/)
    if (m) {
      out.push(m[2]!.trim())
    } else if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${line}`
    } else {
      out.push(line)
    }
  }
  return out.length > 0 ? out : [raw]
}

function addRecommendationsCallouts(pdf: jsPDF, y: number, text: string): number {
  const items = splitRecommendationItems(text)
  const pageW = pdf.internal.pageSize.getWidth()
  const boxW = pageW - 2 * MARGIN
  const padX = 3.8
  const padY = 3.2
  const radius = 2

  let yy = y
  for (const item of items) {
    pdf.setFontSize(FS_BODY)
    setPdfFont(pdf, 'normal')
    const innerW = boxW - 2 * padX
    const lines = pdf.splitTextToSize(item, innerW)
    const boxH = padY * 2 + lines.length * LINE

    yy = ensureY(pdf, yy, boxH + 5)
    const boxTop = yy

    pdf.setFillColor(CALLOUT_BG[0], CALLOUT_BG[1], CALLOUT_BG[2])
    pdf.setDrawColor(CALLOUT_BORDER[0], CALLOUT_BORDER[1], CALLOUT_BORDER[2])
    pdf.setLineWidth(0.12)
    pdf.roundedRect(MARGIN, boxTop, boxW, boxH, radius, radius, 'FD')

    pdf.setDrawColor(0, 0, 0)
    pdf.setTextColor(28, 25, 23)
    let ty = boxTop + padY + 4.1
    for (const ln of lines) {
      pdf.text(ln, MARGIN + padX, ty)
      ty += LINE
    }
    pdf.setTextColor(0, 0, 0)

    yy = boxTop + boxH + 3.25
  }
  return yy
}

function flushPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/**
 * html2canvas often drops SVG bar labels (web fonts, CSS variables). Normalize the clone.
 */
/** Rasterize a chart/table node for PDF (same pipeline as single-tab export). */
export async function captureElementToCanvasForPdf(
  el: HTMLElement
): Promise<HTMLCanvasElement> {
  return canvasFromElement(el)
}

async function canvasFromElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  await flushPaint()
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    onclone: (_doc, cloned) => {
      const root = cloned as HTMLElement
      root.style.backgroundColor = '#ffffff'
      root.style.color = '#1c1917'
      root.querySelectorAll('.hint').forEach((el) => {
        ;(el as HTMLElement).style.color = '#57534e'
      })
      root.querySelectorAll('h3').forEach((el) => {
        const h = el as HTMLElement
        h.style.color = '#1c1917'
        h.style.fontWeight = '600'
      })
      /* Bar rects use clip-path; html2canvas can clip sibling label geometry. */
      root.querySelectorAll('.recharts-bar-rectangles').forEach((node) => {
        const g = node as SVGGElement
        g.removeAttribute('clip-path')
        g.style.clipPath = 'none'
      })
      /* Bar-end % labels use text and/or tspan; force canvas-safe styles. */
      root.querySelectorAll('svg text, svg tspan').forEach((node) => {
        const el = node as SVGElement
        const text = (el.textContent ?? '').trim()
        if (!text) return
        el.setAttribute('fill', '#1c1917')
        el.style.fill = '#1c1917'
        el.style.fontFamily = 'Arial, Helvetica, sans-serif'
        el.style.fontSize = '11px'
        el.style.fontWeight = '600'
        if (!el.getAttribute('font-size') || el.getAttribute('font-size')?.includes('var(')) {
          el.setAttribute('font-size', '11')
        }
      })
    },
  })
}

function scaledDrawSize(
  cw: number,
  ch: number,
  maxW: number,
  maxH: number
): { drawW: number; drawH: number } {
  const ratio = cw / ch
  let drawW = maxW
  let drawH = drawW / ratio
  if (drawH > maxH) {
    drawH = maxH
    drawW = drawH * ratio
  }
  return { drawW, drawH }
}

function addCanvasImage(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  maxW: number,
  maxH: number
): { yEnd: number; drawH: number } {
  const { drawW, drawH } = scaledDrawSize(
    canvas.width || 1,
    canvas.height || 1,
    maxW,
    maxH
  )
  const yy = ensureY(pdf, y, drawH + 4)
  const imgData = canvas.toDataURL('image/png')
  pdf.addImage(imgData, 'PNG', x, yy, drawW, drawH)
  return { yEnd: yy + drawH + 6, drawH }
}

async function loadLogoPngDataUrl(): Promise<{
  dataUrl: string
  aspect: number
} | null> {
  const src = `${window.location.origin}/halda-logo.svg`
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = img.naturalWidth || 200
        const h = img.naturalHeight || 60
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0)
        resolve({
          dataUrl: c.toDataURL('image/png'),
          aspect: w / Math.max(h, 1),
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function addLogoProportional(
  pdf: jsPDF,
  logo: { dataUrl: string; aspect: number },
  xRight: number,
  yTop: number,
  maxWidthMm: number,
  maxHeightMm: number
) {
  const { aspect } = logo
  let drawW = maxWidthMm
  let drawH = drawW / aspect
  if (drawH > maxHeightMm) {
    drawH = maxHeightMm
    drawW = drawH * aspect
  }
  const x = xRight - drawW
  try {
    pdf.addImage(logo.dataUrl, 'PNG', x, yTop, drawW, drawH)
  } catch {
    /* optional */
  }
}

/** One tab’s captured DOM + text for workbook export. */
export type MultiTabPdfSection = {
  tabTitle: string
  insightsText: string
  recommendationsText: string
  reachChartEl: HTMLElement | null
  dropChartEl: HTMLElement | null
  tableEl: HTMLElement | null
  /** Rasterized while that tab was active (required for correct all-tabs PDF). */
  reachChartSnapshot?: HTMLCanvasElement | null
  dropChartSnapshot?: HTMLCanvasElement | null
  tableSnapshot?: HTMLCanvasElement | null
  hasFunnelSteps: boolean
  funnelCoverStats?: PdfFunnelCoverStats | null
}

async function drawWorkbookCover(
  pdf: jsPDF,
  y: number,
  schoolName: string,
  tabTitle: string,
  rgb: [number, number, number],
  logo: Awaited<ReturnType<typeof loadLogoPngDataUrl>>,
  funnelCoverStats?: PdfFunnelCoverStats | null
): Promise<number> {
  const pageW = pdf.internal.pageSize.getWidth()
  const titleLine = 'Drop-Off Analysis'
  setPdfHeadingBold(pdf)
  pdf.setFontSize(FS_TITLE)
  pdf.setTextColor(rgb[0], rgb[1], rgb[2])
  pdf.text(titleLine, MARGIN, y + 5)
  pdf.setTextColor(0, 0, 0)

  if (logo) {
    addLogoProportional(pdf, logo, pageW - MARGIN, y, 40, 12)
  }

  y += 12.5
  pdf.setFontSize(FS_META)
  if (schoolName.trim()) {
    setPdfFont(pdf, 'normal')
    pdf.setTextColor(28, 25, 23)
    pdf.text(schoolName.trim(), MARGIN, y)
    pdf.setTextColor(0, 0, 0)
    y += LINE * 1.25
  }
  setPdfFont(pdf, 'normal')
  pdf.setTextColor(60, 60, 60)
  pdf.text(`Form: ${tabTitle.trim() || 'Untitled'}`, MARGIN, y)
  pdf.setTextColor(0, 0, 0)
  if (funnelCoverStats) {
    y += LINE * 1.2
    y = drawFunnelCoverStats(pdf, y, funnelCoverStats)
  }
  y += HEADER_GAP_BEFORE_RULE_MM
  strokeFullWidthRule(pdf, y)
  y += RULE_PAD_MM
  y += FIRST_SECTION_TOP_PAD_MM
  return y
}

/** Later tabs in all-tabs export: form title (school stays on page 1 only). */
function drawContinuationTabHeader(
  pdf: jsPDF,
  tabTitle: string,
  rgb: [number, number, number],
  funnelCoverStats?: PdfFunnelCoverStats | null
): number {
  let y = MARGIN
  setPdfHeadingBold(pdf)
  pdf.setFontSize(FS_SECTION)
  pdf.setTextColor(rgb[0], rgb[1], rgb[2])
  pdf.text(`Form: ${tabTitle.trim() || 'Untitled'}`, MARGIN, y)
  pdf.setTextColor(0, 0, 0)
  if (funnelCoverStats) {
    y += LINE * 1.15
    y = drawFunnelCoverStats(pdf, y, funnelCoverStats)
  }
  y += HEADER_GAP_BEFORE_RULE_MM
  strokeFullWidthRule(pdf, y)
  y += RULE_PAD_MM
  y += FIRST_SECTION_TOP_PAD_MM
  return y
}

async function reachCanvasForSection(
  sec: Pick<
    MultiTabPdfSection,
    'reachChartSnapshot' | 'reachChartEl'
  >
): Promise<HTMLCanvasElement> {
  if (sec.reachChartSnapshot) return sec.reachChartSnapshot
  return canvasFromElement(sec.reachChartEl!)
}

async function dropCanvasForSection(
  sec: Pick<
    MultiTabPdfSection,
    'dropChartSnapshot' | 'dropChartEl'
  >
): Promise<HTMLCanvasElement> {
  if (sec.dropChartSnapshot) return sec.dropChartSnapshot
  return canvasFromElement(sec.dropChartEl!)
}

async function tableCanvasForSection(
  sec: Pick<
    MultiTabPdfSection,
    'tableSnapshot' | 'tableEl'
  >
): Promise<HTMLCanvasElement> {
  if (sec.tableSnapshot) return sec.tableSnapshot
  return canvasFromElement(sec.tableEl!)
}

async function appendFunnelSectionsToPdf(
  pdf: jsPDF,
  y: number,
  innerW: number,
  rgb: [number, number, number],
  sec: Pick<
    MultiTabPdfSection,
    | 'insightsText'
    | 'recommendationsText'
    | 'reachChartEl'
    | 'dropChartEl'
    | 'tableEl'
    | 'reachChartSnapshot'
    | 'dropChartSnapshot'
    | 'tableSnapshot'
    | 'hasFunnelSteps'
  >,
  s: PdfExportSelection
): Promise<number> {
  const wantReach =
    s.includeReachChart &&
    sec.hasFunnelSteps &&
    (sec.reachChartSnapshot || sec.reachChartEl)
  const wantDrop =
    s.includeDropChart &&
    sec.hasFunnelSteps &&
    (sec.dropChartSnapshot || sec.dropChartEl)
  const wantTable =
    s.includeTable && sec.hasFunnelSteps && (sec.tableSnapshot || sec.tableEl)
  const wantInsights = s.includeInsights && sec.insightsText.trim()
  const wantRecs = s.includeRecommendations && sec.recommendationsText.trim()

  if (wantInsights) {
    y = addSectionTitle(pdf, y, 'Key insights', rgb)
    y = addBody(pdf, y, sec.insightsText)
  }

  if (wantReach && wantDrop) {
    if (wantInsights) y += 3.25
    y = addSectionTitle(pdf, y, REACH_CHART_SECTION_TITLE, rgb, REACH_CHART_DESCRIPTION, {
      compactSubtitle: true,
    })
    const cReach = await reachCanvasForSection(sec)
    y = addCanvasImage(pdf, cReach, MARGIN, y, innerW, 106).yEnd
    y += 3.25
    y = addSectionTitle(
      pdf,
      y,
      DROP_CHART_SECTION_TITLE,
      rgb,
      [DROP_CHART_DESCRIPTION, DROP_CHART_HINT],
      { compactSubtitle: true }
    )
    const cDrop = await dropCanvasForSection(sec)
    y = addCanvasImage(pdf, cDrop, MARGIN, y, innerW, 112).yEnd
  } else if (wantReach) {
    if (wantInsights) y += 3.25
    y = addSectionTitle(pdf, y, REACH_CHART_SECTION_TITLE, rgb, REACH_CHART_DESCRIPTION, {
      compactSubtitle: true,
    })
    const c = await reachCanvasForSection(sec)
    y = addCanvasImage(pdf, c, MARGIN, y, innerW, 112).yEnd
  } else if (wantDrop) {
    if (wantInsights) y += 3.25
    y = addSectionTitle(
      pdf,
      y,
      DROP_CHART_SECTION_TITLE,
      rgb,
      [DROP_CHART_DESCRIPTION, DROP_CHART_HINT],
      { compactSubtitle: true }
    )
    const c = await dropCanvasForSection(sec)
    y = addCanvasImage(pdf, c, MARGIN, y, innerW, 116).yEnd
  }

  if (wantTable) {
    y = addSectionTitle(pdf, y, 'Funnel table', rgb)
    const c = await tableCanvasForSection(sec)
    y = addCanvasImage(pdf, c, MARGIN, y, innerW, 114).yEnd
  }

  if (wantRecs) {
    y = addSectionTitle(pdf, y, 'Recommendations', rgb)
    y = addRecommendationsCallouts(pdf, y, sec.recommendationsText)
  }

  return y
}

function addFooters(pdf: jsPDF, dateStr: string) {
  const n = pdf.getNumberOfPages()
  const pageH = pdf.internal.pageSize.getHeight()
  const pageW = pdf.internal.pageSize.getWidth()
  const footer = `Prepared by Halda · ${dateStr} · Confidential`
  /** Baseline distance from bottom edge of page (mm). */
  const footerBaselineFromBottom = 4.5
  /** Cap height ≈ FS_FOOTER pt → mm; keeps RULE_PAD_MM clear below the rule before ink. */
  const footerAscenderMm = FS_FOOTER * 0.35
  const footerBaselineY = pageH - footerBaselineFromBottom
  const footerRuleY =
    footerBaselineY - RULE_PAD_MM - footerAscenderMm

  pdf.setFontSize(FS_FOOTER)
  setPdfFont(pdf, 'normal')
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i)
    strokeFullWidthRule(pdf, footerRuleY)
    pdf.setTextColor(90, 90, 90)
    pdf.text(footer, pageW / 2, footerBaselineY, { align: 'center' })
  }
  pdf.setTextColor(0, 0, 0)
}

export async function exportAnalysisPdf(
  opts: ExportAnalysisPdfOptions
): Promise<void> {
  const {
    reachChartEl,
    dropChartEl,
    tableEl,
    schoolName,
    tabTitle,
    funnelCoverStats,
    accentHex,
    insightsText,
    recommendationsText,
    selection: s,
  } = opts

  const rgb = parseAccentHex(
    normalizeHex(accentHex ?? '') ?? APP_ACCENT_HEX
  )

  const hasFunnelSteps = Boolean(reachChartEl)
  const wantReach = s.includeReachChart && reachChartEl
  const wantDrop = s.includeDropChart && dropChartEl
  const wantTable = s.includeTable && tableEl
  const wantInsights = s.includeInsights && insightsText.trim()
  const wantRecs = s.includeRecommendations && recommendationsText.trim()

  if (!wantReach && !wantDrop && !wantTable && !wantInsights && !wantRecs) {
    throw new Error(
      'Select at least one section to export and ensure it has content (e.g. fill insights text or enable charts).'
    )
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await ensureInterFont(pdf)

  const pageW = pdf.internal.pageSize.getWidth()
  const innerW = pageW - 2 * MARGIN
  const logo = await loadLogoPngDataUrl()
  let y = await drawWorkbookCover(
    pdf,
    MARGIN,
    schoolName,
    tabTitle,
    rgb,
    logo,
    funnelCoverStats
  )

  y = await appendFunnelSectionsToPdf(
    pdf,
    y,
    innerW,
    rgb,
    {
      insightsText,
      recommendationsText,
      reachChartEl,
      dropChartEl,
      tableEl,
      hasFunnelSteps,
    },
    s
  )

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  addFooters(pdf, dateStr)

  pdf.save(`${safeFilenamePart(tabTitle || 'analysis')}-dropoff.pdf`)
}

/**
 * One PDF with the same sections as the per-tab export, repeated for each tab
 * (new page per tab). Caller must capture DOM refs after each tab is active.
 */
export async function exportAllTabsAnalysisPdf(opts: {
  schoolName: string
  selection: PdfExportSelection
  tabs: MultiTabPdfSection[]
  accentHex?: string
}): Promise<void> {
  const { schoolName, selection, tabs, accentHex } = opts
  const usable = tabs.filter((t) => {
    const wantReach =
      selection.includeReachChart &&
      t.hasFunnelSteps &&
      (t.reachChartSnapshot || t.reachChartEl)
    const wantDrop =
      selection.includeDropChart &&
      t.hasFunnelSteps &&
      (t.dropChartSnapshot || t.dropChartEl)
    const wantTable =
      selection.includeTable &&
      t.hasFunnelSteps &&
      (t.tableSnapshot || t.tableEl)
    const wantInsights =
      selection.includeInsights && t.insightsText.trim()
    const wantRecs =
      selection.includeRecommendations && t.recommendationsText.trim()
    return wantReach || wantDrop || wantTable || wantInsights || wantRecs
  })

  if (usable.length === 0) {
    throw new Error(
      'No tab has anything to export with the current checkboxes (add CSV + flow, or insights/recommendations).'
    )
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  await ensureInterFont(pdf)
  const rgb = parseAccentHex(
    normalizeHex(accentHex ?? '') ?? APP_ACCENT_HEX
  )
  const pageW = pdf.internal.pageSize.getWidth()
  const innerW = pageW - 2 * MARGIN
  const logo = await loadLogoPngDataUrl()

  for (let i = 0; i < usable.length; i++) {
    const sec = usable[i]!
    if (i > 0) pdf.addPage()
    const y0 =
      i === 0
        ? await drawWorkbookCover(
            pdf,
            MARGIN,
            schoolName,
            sec.tabTitle,
            rgb,
            logo,
            sec.funnelCoverStats
          )
        : drawContinuationTabHeader(
            pdf,
            sec.tabTitle,
            rgb,
            sec.funnelCoverStats
          )
    await appendFunnelSectionsToPdf(pdf, y0, innerW, rgb, sec, selection)
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  addFooters(pdf, dateStr)

  const base =
    safeFilenamePart(schoolName || 'all-forms') + '-all-tabs-dropoff'
  pdf.save(`${base}.pdf`)
}
