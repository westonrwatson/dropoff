import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { flushSync } from 'react-dom'
import {
  parseCSVFile,
  parseCSVString,
  maxDateInColumn,
  mergeDatasets,
  datasetToCsvText,
  pickFreshnessColumn,
  inferVariantFromDataset,
  inferExportLabels,
} from './lib/csv'
import { filterTabRows } from './lib/filterRows'
import { computeFunnel } from './lib/metrics'
import {
  captureElementToCanvasForPdf,
  exportAllTabsAnalysisPdf,
  exportAnalysisPdf,
  type PdfExportSelection,
  type MultiTabPdfSection,
} from './lib/exportPdf'
import { cssVarsForAccent } from './lib/accentTheme'
import { APP_ACCENT_HEX, normalizeHex } from './lib/chartAccent'
import { loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from './lib/persistence'
import { richTextToPlain } from './lib/richText'
import { createDefaultTab } from './lib/tabDefaults'
import {
  buildFlowFromReviewQuestions,
  parseHaldaReviewDocx,
} from './lib/reviewDocx'
import type { AnalysisTab, ParsedDataset, TabCollapsedPanels } from './types'
import { CollapsibleSection } from './components/CollapsibleSection'
import { SchoolNameHeader } from './components/SchoolNameHeader'
import { TabBar } from './components/TabBar'
import { FlowBuilder } from './components/FlowBuilder'
import { FunnelCharts } from './components/FunnelCharts'
import { FunnelTable } from './components/FunnelTable'
import { InsightsPanel } from './components/InsightsPanel'
import { VariantFilter } from './components/VariantFilter'
import './App.css'

type InitialBundle = {
  schoolName: string
  schoolAccentHex: string
  tabs: AnalysisTab[]
  activeTabId: string
  csvOmitted: boolean
}

function readInitialBundle(): InitialBundle {
  const w = loadWorkspace()
  if (!w) {
    const t = createDefaultTab([], 0)
    return {
      schoolName: '',
      schoolAccentHex: APP_ACCENT_HEX,
      tabs: [t],
      activeTabId: t.id,
      csvOmitted: false,
    }
  }
  return {
    schoolName: w.schoolName ?? '',
    schoolAccentHex:
      normalizeHex(w.schoolAccentHex ?? '') ?? APP_ACCENT_HEX,
    tabs: w.tabs,
    activeTabId:
      w.activeTabId && w.tabs.some((t) => t.id === w.activeTabId)
        ? w.activeTabId
        : (w.tabs[0]?.id ?? ''),
    csvOmitted: Boolean(w._csvOmitted),
  }
}

const INIT = readInitialBundle()

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )
  useEffect(() => {
    const q = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = () => setDark(q.matches)
    fn()
    q.addEventListener('change', fn)
    return () => q.removeEventListener('change', fn)
  }, [])
  return dark
}

function useDebouncedEffect(
  fn: () => void,
  deps: unknown[],
  ms: number
) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce snapshot only
  }, deps)
}

function parseTabDataset(tab: AnalysisTab | null): ParsedDataset | null {
  if (!tab?.csvText?.trim()) return null
  try {
    return parseCSVString(tab.csvText)
  } catch {
    return null
  }
}

/** After switching tabs with flushSync, wait for layout/paint so PDF refs match that tab. */
function waitForTabDomAfterSwitch(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => resolve(), 220)
      })
    })
  })
}

function flowSummary(tab: AnalysisTab): string {
  const n = tab.steps.length
  const fields = tab.steps.reduce((a, s) => a + s.fields.length, 0)
  const base = `${n} question${n === 1 ? '' : 's'} · ${fields} CSV column${fields === 1 ? '' : 's'} mapped`
  const rn = tab.reviewDocName?.trim()
  if (rn) {
    const short = rn.length > 32 ? `${rn.slice(0, 29)}…` : rn
    return `${base} · Review: ${short}`
  }
  return base
}

function tabHasPdfContent(tab: AnalysisTab, sel: PdfExportSelection): boolean {
  const ds = parseTabDataset(tab)
  if (!ds?.rows.length) {
    return (
      (sel.includeInsights && Boolean(tab.insightsText?.trim())) ||
      (sel.includeRecommendations && Boolean(tab.recommendationsText?.trim()))
    )
  }
  const rows = filterTabRows(ds.rows, tab)
  const f = computeFunnel(rows, tab)
  const hasFunnel = Boolean(f?.steps.length)
  return (
    (sel.includeReachChart && hasFunnel) ||
    (sel.includeDropChart && hasFunnel) ||
    (sel.includeTable && hasFunnel) ||
    (sel.includeInsights && Boolean(tab.insightsText?.trim())) ||
    (sel.includeRecommendations && Boolean(tab.recommendationsText?.trim()))
  )
}

export default function App() {
  const [csvOmitted, setCsvOmitted] = useState(INIT.csvOmitted)
  const [schoolName, setSchoolName] = useState(INIT.schoolName)
  const [schoolAccentHex, setSchoolAccentHex] = useState(
    INIT.schoolAccentHex
  )
  const [accentDraft, setAccentDraft] = useState(INIT.schoolAccentHex)
  const [tabs, setTabs] = useState<AnalysisTab[]>(INIT.tabs)
  const [activeTabId, setActiveTabId] = useState(INIT.activeTabId)
  const prefersDark = usePrefersDark()
  const [pdfExporting, setPdfExporting] = useState(false)
  const [pdfSelection, setPdfSelection] = useState<PdfExportSelection>({
    includeReachChart: true,
    includeDropChart: true,
    includeTable: false,
    includeInsights: true,
    includeRecommendations: true,
  })
  const pdfReachRef = useRef<HTMLDivElement>(null)
  const pdfDropRef = useRef<HTMLDivElement>(null)
  const pdfTableRef = useRef<HTMLDivElement>(null)

  const snapshot = useMemo(
    (): WorkspaceSnapshot => ({
      version: 2,
      schoolName,
      schoolAccentHex,
      tabs,
      activeTabId,
    }),
    [schoolName, schoolAccentHex, tabs, activeTabId]
  )

  const accentSurfaceStyle = useMemo(
    () => cssVarsForAccent(schoolAccentHex, prefersDark),
    [schoolAccentHex, prefersDark]
  )

  useDebouncedEffect(() => {
    saveWorkspace(snapshot)
  }, [snapshot], 500)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const tabDataset = useMemo(
    () => parseTabDataset(activeTab),
    [activeTab]
  )

  const filteredRows = useMemo(() => {
    if (!tabDataset || !activeTab) return []
    return filterTabRows(tabDataset.rows, activeTab)
  }, [tabDataset, activeTab])

  const funnel = useMemo(() => {
    if (!activeTab) return null
    return computeFunnel(filteredRows, activeTab)
  }, [filteredRows, activeTab])

  const freshnessColumn = useMemo(
    () => (tabDataset ? pickFreshnessColumn(tabDataset.headers) : null),
    [tabDataset]
  )

  const freshness = useMemo(() => {
    if (!tabDataset?.rows.length || !freshnessColumn) return null
    return maxDateInColumn(tabDataset.rows, freshnessColumn)
  }, [tabDataset, freshnessColumn])

  const insightsSummary = useMemo(() => {
    if (!activeTab) return 'Empty'
    const a = richTextToPlain(activeTab.insightsText ?? '').trim()
    const b = richTextToPlain(activeTab.recommendationsText ?? '').trim()
    const raw =
      a.split('\n').find((l) => l.replace(/^•\s*/, '').trim()) ||
      b.split('\n').find((l) => l.replace(/^•\s*/, '').trim())
    if (!raw) return 'Empty'
    const cleaned = raw.replace(/^•\s*/, '').trim()
    return cleaned.length > 56 ? `${cleaned.slice(0, 56)}…` : cleaned
  }, [activeTab])

  const onTabFiles = useCallback(
    async (files: FileList | null) => {
      if (!activeTabId || !files || files.length === 0) return
      try {
        const parsed = await Promise.all(Array.from(files).map(parseCSVFile))
        const d =
          parsed.length === 1 ? parsed[0]! : mergeDatasets(parsed)
        const csvText = datasetToCsvText(d)
        const csvNames = Array.from(files).map((f) => f.name)
        const { variantColumn, variantValue } = inferVariantFromDataset(d)
        const inferred = inferExportLabels(d, csvNames)
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  csvText,
                  csvNames,
                  reviewDocName: undefined,
                  variantColumn,
                  variantValue,
                  title:
                    inferred.formTitle &&
                    (/^Form \d+$/i.test(t.title.trim()) ||
                      !t.title.trim())
                      ? inferred.formTitle
                      : t.title,
                  collapsedPanels: {
                    ...(t.collapsedPanels ?? {}),
                    csv: false,
                  },
                }
              : t
          )
        )
        setSchoolName((prev) =>
          inferred.schoolName && !prev.trim()
            ? inferred.schoolName
            : prev
        )
        setCsvOmitted(false)
      } catch (e) {
        console.error(e)
        alert(e instanceof Error ? e.message : 'Failed to parse CSV')
      }
    },
    [activeTabId]
  )

  const activeStepCount = activeTab?.steps.length ?? 0

  const onReviewDoc = useCallback(
    async (files: FileList | null) => {
      if (!activeTabId || !files?.[0] || !tabDataset) return
      const file = files[0]
      if (!file.name.toLowerCase().endsWith('.docx')) {
        alert('Please upload a .docx Halda review export.')
        return
      }
      if (
        activeStepCount > 0 &&
        !window.confirm(
          'Replace the current form flow with questions inferred from this review doc?'
        )
      ) {
        return
      }
      try {
        const questions = await parseHaldaReviewDocx(file)
        const steps = buildFlowFromReviewQuestions(
          questions,
          tabDataset.headers,
          tabDataset.rows
        )
        if (steps.length === 0) {
          alert(
            'No questions could be matched to CSV columns. Check that this review matches the uploaded export.'
          )
          return
        }
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  steps,
                  reviewDocName: file.name,
                  collapsedPanels: {
                    ...(t.collapsedPanels ?? {}),
                    // Keep CSV/Doc open: CollapsibleSection unmounts children when collapsed, which
                    // removed the file input / drop zone and made re-upload look "broken".
                    csv: false,
                    flow: false,
                  },
                }
              : t
          )
        )
      } catch (e) {
        console.error(e)
        alert(e instanceof Error ? e.message : 'Failed to read review doc')
      }
    },
    [activeTabId, tabDataset, activeStepCount]
  )

  const csvDragDepth = useRef(0)
  const [csvDragOver, setCsvDragOver] = useState(false)
  const reviewDragDepth = useRef(0)
  const [reviewDragOver, setReviewDragOver] = useState(false)

  const onCsvDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    csvDragDepth.current++
    setCsvDragOver(true)
  }, [])

  const onCsvDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    csvDragDepth.current--
    if (csvDragDepth.current <= 0) {
      csvDragDepth.current = 0
      setCsvDragOver(false)
    }
  }, [])

  const onCsvDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCsvDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      csvDragDepth.current = 0
      setCsvDragOver(false)
      if (!activeTabId) return
      const picked = Array.from(e.dataTransfer.files).filter(
        (f) =>
          f.name.toLowerCase().endsWith('.csv') ||
          f.type === 'text/csv' ||
          f.type === 'application/vnd.ms-excel'
      )
      if (!picked.length) return
      const dt = new DataTransfer()
      for (const f of picked) {
        dt.items.add(f)
      }
      await onTabFiles(dt.files)
    },
    [activeTabId, onTabFiles]
  )

  const onReviewDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!tabDataset) return
      reviewDragDepth.current++
      setReviewDragOver(true)
    },
    [tabDataset]
  )

  const onReviewDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (reviewDragDepth.current <= 0) return
    reviewDragDepth.current--
    if (reviewDragDepth.current <= 0) {
      reviewDragDepth.current = 0
      setReviewDragOver(false)
    }
  }, [])

  const onReviewDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = tabDataset ? 'copy' : 'none'
    },
    [tabDataset]
  )

  const onReviewDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      reviewDragDepth.current = 0
      setReviewDragOver(false)
      if (!tabDataset) return
      const docx = Array.from(e.dataTransfer.files).find((f) =>
        f.name.toLowerCase().endsWith('.docx')
      )
      if (!docx) return
      const dt = new DataTransfer()
      dt.items.add(docx)
      await onReviewDoc(dt.files)
    },
    [onReviewDoc, tabDataset]
  )

  const updateActiveTab = useCallback(
    (patch: Partial<AnalysisTab>) => {
      if (!activeTabId) return
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, ...patch } : t))
      )
    },
    [activeTabId]
  )

  const toggleTabPanel = useCallback(
    (key: keyof TabCollapsedPanels) => {
      if (!activeTabId) return
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t
          const cur = t.collapsedPanels ?? {}
          return {
            ...t,
            collapsedPanels: { ...cur, [key]: !cur[key] },
          }
        })
      )
    },
    [activeTabId]
  )

  const addTab = () => {
    const t = createDefaultTab([], tabs.length)
    setTabs((prev) => [...prev, t])
    setActiveTabId(t.id)
  }

  const updateTabTitle = useCallback((id: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title } : t))
    )
  }, [])

  const removeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeTabId === id) {
        setActiveTabId(next[0]?.id ?? '')
      }
      return next
    })
  }

  const hasFunnelSteps = Boolean(funnel && funnel.steps.length > 0)
  const canExportPdf =
    !!activeTab &&
    ((pdfSelection.includeReachChart && hasFunnelSteps) ||
      (pdfSelection.includeDropChart && hasFunnelSteps) ||
      (pdfSelection.includeTable && hasFunnelSteps) ||
      (pdfSelection.includeInsights &&
        Boolean(activeTab.insightsText?.trim())) ||
      (pdfSelection.includeRecommendations &&
        Boolean(activeTab.recommendationsText?.trim())))

  const canExportAllTabsPdf =
    tabs.length > 0 && tabs.some((t) => tabHasPdfContent(t, pdfSelection))

  const handleExportPdf = useCallback(async () => {
    if (!activeTab || !canExportPdf) return
    setPdfExporting(true)
    try {
      await exportAnalysisPdf({
        reachChartEl: pdfReachRef.current,
        dropChartEl: pdfDropRef.current,
        tableEl: pdfTableRef.current,
        schoolName,
        tabTitle: activeTab.title.trim() || 'Untitled',
        funnelCoverStats:
          funnel && funnel.steps.length > 0
            ? {
                partialLeads: funnel.partialLeads,
                largestIncrementalDrop: funnel.topIncrementalDropStep
                  ? {
                      pct: funnel.topIncrementalDropStep.pct,
                      label: funnel.topIncrementalDropStep.label,
                    }
                  : null,
              }
            : undefined,
        accentHex: schoolAccentHex,
        insightsText: activeTab.insightsText ?? '',
        recommendationsText: activeTab.recommendationsText ?? '',
        selection: pdfSelection,
      })
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not create PDF')
    } finally {
      setPdfExporting(false)
    }
  }, [
    activeTab,
    canExportPdf,
    schoolName,
    schoolAccentHex,
    pdfSelection,
    funnel,
  ])

  const handleExportAllTabsPdf = useCallback(async () => {
    if (!canExportAllTabsPdf) return
    setPdfExporting(true)
    const savedId = activeTabId
    const sections: MultiTabPdfSection[] = []
    try {
      for (const tab of tabs) {
        if (!tabHasPdfContent(tab, pdfSelection)) continue
        flushSync(() => setActiveTabId(tab.id))
        await waitForTabDomAfterSwitch()
        const ds = parseTabDataset(tab)
        const rows = ds ? filterTabRows(ds.rows, tab) : []
        const f =
          ds && tab.steps.some((s) => s.fields.length > 0)
            ? computeFunnel(rows, tab)
            : null
        const hasF = Boolean(f?.steps.length)
        const reachEl = pdfReachRef.current
        const dropEl = pdfDropRef.current
        const tableEl = pdfTableRef.current
        sections.push({
          tabTitle: tab.title.trim() || 'Untitled',
          insightsText: tab.insightsText ?? '',
          recommendationsText: tab.recommendationsText ?? '',
          reachChartEl: null,
          dropChartEl: null,
          tableEl: null,
          reachChartSnapshot:
            pdfSelection.includeReachChart && hasF && reachEl
              ? await captureElementToCanvasForPdf(reachEl)
              : undefined,
          dropChartSnapshot:
            pdfSelection.includeDropChart && hasF && dropEl
              ? await captureElementToCanvasForPdf(dropEl)
              : undefined,
          tableSnapshot:
            pdfSelection.includeTable && hasF && tableEl
              ? await captureElementToCanvasForPdf(tableEl)
              : undefined,
          hasFunnelSteps: hasF,
          funnelCoverStats:
            f && f.steps.length > 0
              ? {
                  partialLeads: f.partialLeads,
                  largestIncrementalDrop: f.topIncrementalDropStep
                    ? {
                        pct: f.topIncrementalDropStep.pct,
                        label: f.topIncrementalDropStep.label,
                      }
                    : null,
                }
              : undefined,
        })
      }
      await exportAllTabsAnalysisPdf({
        schoolName,
        selection: pdfSelection,
        tabs: sections,
        accentHex: schoolAccentHex,
      })
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not create PDF')
    } finally {
      flushSync(() => setActiveTabId(savedId))
      setPdfExporting(false)
    }
  }, [
    canExportAllTabsPdf,
    tabs,
    pdfSelection,
    schoolName,
    schoolAccentHex,
    activeTabId,
  ])

  return (
    <div className="app" style={accentSurfaceStyle}>
      <header id="page-top" className="app-header">
        <div className="header-top">
          <div className="header-top-text">
            <h1>Drop-off analysis</h1>
            <SchoolNameHeader
              schoolName={schoolName}
              onSave={setSchoolName}
            />
          </div>
          <div className="header-halda-brand">
            <img
              src="/halda-logo.svg"
              alt="Halda"
              className="header-halda-logo"
            />
          </div>
        </div>
        <p className="tagline">
          Turn form or survey exports into a clear picture of where people stop
          before finishing. Upload lead-level data, map each CSV column to the
          page it belongs on, and see completion, drop-off, and recommendations you
          can share with a school—one analysis per tab.
        </p>
        <div className="school-colors-row">
          <label htmlFor="school-accent-hex" className="school-colors-label">
            School Colors
          </label>
          <input
            id="school-accent-hex"
            type="text"
            className="school-colors-hex-input"
            value={accentDraft}
            onChange={(e) => {
              const v = e.target.value
              setAccentDraft(v)
              const n = normalizeHex(v)
              if (n) setSchoolAccentHex(n)
            }}
            onBlur={() => {
              const n = normalizeHex(accentDraft)
              if (n) {
                setSchoolAccentHex(n)
                setAccentDraft(n)
              } else {
                setAccentDraft(schoolAccentHex)
              }
            }}
            placeholder={APP_ACCENT_HEX}
            spellCheck={false}
            autoComplete="off"
            aria-label="School accent color as hex"
          />
          <input
            type="color"
            className="school-colors-picker"
            value={schoolAccentHex}
            onChange={(e) => {
              const v = e.target.value
              setSchoolAccentHex(v)
              setAccentDraft(v)
            }}
            aria-label="Pick school accent color"
          />
        </div>
      </header>

      {csvOmitted && (
        <div className="toolbar-stack">
          <p className="warn-banner panel">
            CSV text was not stored (size limit). Re-upload CSV on each tab that
            needs data; other tab settings are restored.
          </p>
        </div>
      )}

      {tabs.length === 0 && (
        <div className="empty-state panel">
          <p>No analysis tabs open.</p>
          <button type="button" className="btn primary" onClick={addTab}>
            Add analysis tab
          </button>
        </div>
      )}

      {tabs.length > 0 && (
        <>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onUpdateTabTitle={updateTabTitle}
            onRemoveTab={removeTab}
            onAddTab={addTab}
            onDownloadAllTabsPdf={() => void handleExportAllTabsPdf()}
            downloadAllPdfDisabled={pdfExporting || !canExportAllTabsPdf}
          />

          {activeTab && (
            <div className="tab-body">
              <CollapsibleSection
                className="tab-csv-panel"
                title="CSV/Doc upload"
                summary={
                  !activeTab.csvText?.trim()
                    ? 'No file'
                    : tabDataset
                      ? `${activeTab.csvNames[0] ?? 'CSV'} · ${tabDataset.rows.length.toLocaleString()} rows`
                      : 'Parse error'
                }
                collapsed={Boolean(activeTab.collapsedPanels?.csv)}
                onToggle={() => toggleTabPanel('csv')}
              >
                <div
                  className={`file-drop-zone${csvDragOver ? ' is-drag-over' : ''}`}
                  onDragEnter={onCsvDragEnter}
                  onDragLeave={onCsvDragLeave}
                  onDragOver={onCsvDragOver}
                  onDrop={onCsvDrop}
                  role="region"
                  aria-label="CSV upload: drag and drop or choose files"
                >
                  <p className="hint">
                    Upload CSV for <strong>this tab only</strong>. Prefer exports
                    with <strong>AI Form Name</strong> and <strong>Host URL</strong>{' '}
                    or <strong>URL</strong>. After upload, check the tab title and
                    school and edit if they’re wrong.
                  </p>
                  <p className="file-drop-hint">
                    Drag and drop CSV files here, or use the button.
                  </p>
                  <label className="btn primary file-btn">
                    Upload CSV(s)
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        onTabFiles(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                <div
                  className={`review-doc-row${reviewDragOver ? ' is-drag-over' : ''}`}
                  onDragEnter={onReviewDragEnter}
                  onDragLeave={onReviewDragLeave}
                  onDragOver={onReviewDragOver}
                  onDrop={onReviewDrop}
                  role="region"
                  aria-label="Review document upload: drag and drop or choose file"
                >
                  <p className="hint review-doc-hint">
                    Upload a Halda <strong>Review</strong> Word export
                    (.docx) to build the form flow from screen questions. Upload
                    CSV first, then confirm or adjust questions under Form flow.
                  </p>
                  <p className="file-drop-hint">
                    {tabDataset
                      ? 'Drag and drop a .docx file here, or use the button.'
                      : 'After CSV is loaded, you can drag and drop a review .docx here.'}
                  </p>
                  <div className="review-doc-actions">
                    <label
                      className={
                        tabDataset
                          ? 'btn secondary file-btn'
                          : 'btn secondary file-btn is-disabled'
                      }
                    >
                      Upload review (.docx)
                      <input
                        type="file"
                        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="sr-only"
                        disabled={!tabDataset}
                        onChange={(e) => {
                          void onReviewDoc(e.target.files)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {!tabDataset ? (
                      <span className="review-doc-need-csv">CSV required first.</span>
                    ) : activeTab.reviewDocName ? (
                      <span
                        className="meta-line review-doc-meta"
                        title={activeTab.reviewDocName}
                      >
                        Flow from: <strong>{activeTab.reviewDocName}</strong>
                      </span>
                    ) : null}
                  </div>
                </div>
                {activeTab.csvText && tabDataset && (
                  <p className="meta-line tab-csv-meta">
                    <strong>
                      {activeTab.csvNames.length === 0
                        ? 'Loaded CSV'
                        : activeTab.csvNames.length === 1
                          ? activeTab.csvNames[0]
                          : `${activeTab.csvNames.length} files merged`}
                    </strong>
                    {' · '}
                    {tabDataset.rows.length.toLocaleString()} rows ·{' '}
                    {tabDataset.headers.length} columns
                    {freshness ? ` · latest row through ${freshness}` : null}
                    {activeTab.csvNames.length > 1 && (
                      <span
                        className="file-list"
                        title={activeTab.csvNames.join('\n')}
                      >
                        {' '}
                        (hover for filenames)
                      </span>
                    )}
                  </p>
                )}
                {activeTab.csvText && !tabDataset && (
                  <p className="warn-inline">
                    Saved CSV could not be parsed. Upload a valid file again.
                  </p>
                )}
              </CollapsibleSection>

              {!tabDataset && (
                <div className="empty-state panel subtle">
                  <p>
                    Upload a CSV above to set filters, build the flow, and view
                    charts for this tab.
                  </p>
                </div>
              )}

              {tabDataset && (
                <>
                  <CollapsibleSection
                    title="Slice"
                    collapsed={Boolean(activeTab.collapsedPanels?.variant)}
                    onToggle={() => toggleTabPanel('variant')}
                  >
                    <VariantFilter
                      tab={activeTab}
                      rows={tabDataset.rows}
                      headers={tabDataset.headers}
                      onChange={updateActiveTab}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Form flow (pages)"
                    summary={flowSummary(activeTab)}
                    collapsed={Boolean(activeTab.collapsedPanels?.flow)}
                    onToggle={() => toggleTabPanel('flow')}
                  >
                    <FlowBuilder
                      headers={tabDataset.headers}
                      steps={activeTab.steps}
                      onChange={(steps) => updateActiveTab({ steps })}
                    />
                  </CollapsibleSection>

                  <p className="filtered-rows-note">
                    <strong>{filteredRows.length.toLocaleString()}</strong> rows.
                  </p>

                  {funnel && funnel.steps.length > 0 && (
                    <section className="kpi-strip panel">
                      <div className="kpi">
                        <span className="kpi-label">Partial leads</span>
                        <span className="kpi-value">
                          {funnel.partialLeads.toLocaleString()}
                        </span>
                      </div>
                      {funnel.topIncrementalDropStep && (
                        <div className="kpi wide">
                          <span className="kpi-label">
                            Largest incremental drop
                          </span>
                          <span className="kpi-value small">
                            {funnel.topIncrementalDropStep.pct.toFixed(1)}% at “
                            {funnel.topIncrementalDropStep.label}”
                          </span>
                        </div>
                      )}
                    </section>
                  )}

                  {funnel && (
                    <>
                      <FunnelCharts
                        funnel={funnel}
                        reachSectionRef={pdfReachRef}
                        dropSectionRef={pdfDropRef}
                        accentHex={schoolAccentHex}
                      />
                      <FunnelTable
                        funnel={funnel}
                        tableCaptureRef={pdfTableRef}
                      />
                    </>
                  )}

                  <CollapsibleSection
                    title="Key insights & recommendations"
                    summary={insightsSummary}
                    collapsed={Boolean(activeTab.collapsedPanels?.insights)}
                    onToggle={() => toggleTabPanel('insights')}
                  >
                    <InsightsPanel
                      key={activeTab.id}
                      funnel={funnel}
                      flowSteps={activeTab.steps}
                      tabTitle={activeTab.title}
                      insightsText={activeTab.insightsText}
                      recommendationsText={activeTab.recommendationsText}
                      onInsightsChange={(insightsText) =>
                        updateActiveTab({ insightsText })
                      }
                      onRecommendationsChange={(recommendationsText) =>
                        updateActiveTab({ recommendationsText })
                      }
                      onAiFilled={(insightsText, recommendationsText) =>
                        updateActiveTab({ insightsText, recommendationsText })
                      }
                    />
                  </CollapsibleSection>

                  <div className="tab-pdf-export panel">
                    <p className="tab-pdf-export-copy">
                      Build a PDF for{' '}
                      <strong>
                        {activeTab.title.trim() || 'this tab'}
                      </strong>
                      : choose sections below, then export. Only this tab is
                      included.
                    </p>
                    <div className="pdf-export-options">
                      <p className="pdf-export-options-label">Include in PDF</p>
                      <label className="pdf-export-check">
                        <input
                          type="checkbox"
                          checked={pdfSelection.includeReachChart}
                          disabled={!hasFunnelSteps}
                          onChange={(e) =>
                            setPdfSelection((p) => ({
                              ...p,
                              includeReachChart: e.target.checked,
                            }))
                          }
                        />
                        Cumulative Completion chart
                      </label>
                      <label className="pdf-export-check">
                        <input
                          type="checkbox"
                          checked={pdfSelection.includeDropChart}
                          disabled={!hasFunnelSteps}
                          onChange={(e) =>
                            setPdfSelection((p) => ({
                              ...p,
                              includeDropChart: e.target.checked,
                            }))
                          }
                        />
                        Where Students Stopped chart
                      </label>
                      <label className="pdf-export-check">
                        <input
                          type="checkbox"
                          checked={pdfSelection.includeTable}
                          disabled={!hasFunnelSteps}
                          onChange={(e) =>
                            setPdfSelection((p) => ({
                              ...p,
                              includeTable: e.target.checked,
                            }))
                          }
                        />
                        Funnel table
                      </label>
                      <label className="pdf-export-check">
                        <input
                          type="checkbox"
                          checked={pdfSelection.includeInsights}
                          onChange={(e) =>
                            setPdfSelection((p) => ({
                              ...p,
                              includeInsights: e.target.checked,
                            }))
                          }
                        />
                        Key insights (intro)
                      </label>
                      <label className="pdf-export-check">
                        <input
                          type="checkbox"
                          checked={pdfSelection.includeRecommendations}
                          onChange={(e) =>
                            setPdfSelection((p) => ({
                              ...p,
                              includeRecommendations: e.target.checked,
                            }))
                          }
                        />
                        Recommendations
                      </label>
                    </div>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!canExportPdf || pdfExporting}
                      onClick={() => void handleExportPdf()}
                    >
                      {pdfExporting
                        ? 'Exporting PDF…'
                        : 'Export this tab to PDF'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="back-to-top-footer">
            <button
              type="button"
              className="btn ghost back-to-top"
              onClick={() => {
                document
                  .getElementById('page-top')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              Back to top
            </button>
          </div>
        </>
      )}
    </div>
  )
}
