import { parseCSVString } from './csv'
import { createDefaultTab } from './tabDefaults'
import type { AnalysisTab, TabCollapsedPanels } from '../types'

const STORAGE_KEY = 'dropoff-dashboard-workspace-v1'

export type WorkspaceSnapshot = {
  version: 2
  schoolName: string
  /** Primary UI / chart accent, e.g. #4fabff */
  schoolAccentHex?: string
  tabs: AnalysisTab[]
  activeTabId: string
  _csvOmitted?: boolean
}

type LegacyWorkspaceV1 = {
  version: 1
  schoolName?: string
  csvText?: string
  tabs: AnalysisTab[]
  activeTabId?: string
  _csvOmitted?: boolean
}

function normalizeCollapsedPanels(raw: unknown): TabCollapsedPanels {
  if (!raw || typeof raw !== 'object') return {}
  const o = { ...(raw as TabCollapsedPanels) } as Record<
    string,
    boolean | undefined
  >
  if (
    'scope' in o &&
    o.variant === undefined &&
    typeof o.scope === 'boolean'
  ) {
    o.variant = o.scope
  }
  delete o.scope
  delete o.title
  return o as TabCollapsedPanels
}

function normalizeTab(t: AnalysisTab | Record<string, unknown>): AnalysisTab {
  const x = t as AnalysisTab
  return {
    ...x,
    csvText: typeof x.csvText === 'string' ? x.csvText : '',
    csvNames: Array.isArray(x.csvNames) ? x.csvNames : [],
    reviewDocName:
      typeof x.reviewDocName === 'string' ? x.reviewDocName : undefined,
    collapsedPanels: normalizeCollapsedPanels(x.collapsedPanels),
  }
}

function migrateFromV1(data: LegacyWorkspaceV1): WorkspaceSnapshot {
  const schoolName = data.schoolName ?? ''
  const activeTabId = data.activeTabId ?? ''
  const omitted = Boolean(data._csvOmitted)
  const csvText = omitted ? '' : String(data.csvText ?? '')
  let tabs = (data.tabs ?? []).map((t) =>
    normalizeTab({ ...(t as AnalysisTab), csvText, csvNames: [] })
  )
  if (tabs.length === 0 && csvText.trim()) {
    try {
      const d = parseCSVString(csvText)
      const base = createDefaultTab(d.headers, 0)
      tabs = [{ ...base, csvText, csvNames: [] }]
    } catch {
      tabs = []
    }
  }
  const aid =
    activeTabId && tabs.some((t) => t.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id ?? '')
  return {
    version: 2,
    schoolName,
    tabs,
    activeTabId: aid,
    _csvOmitted: omitted || undefined,
  }
}

export function loadWorkspace(): WorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as LegacyWorkspaceV1 | WorkspaceSnapshot
    if (!Array.isArray(data.tabs)) return null
    if (data.version === 2) {
      const v2 = data as WorkspaceSnapshot
      return {
        version: 2,
        schoolName: data.schoolName ?? '',
        schoolAccentHex:
          typeof v2.schoolAccentHex === 'string'
            ? v2.schoolAccentHex
            : undefined,
        tabs: data.tabs.map((t) => normalizeTab(t as AnalysisTab)),
        activeTabId:
          data.activeTabId && data.tabs.some((t) => t.id === data.activeTabId)
            ? data.activeTabId
            : (data.tabs[0]?.id as string) ?? '',
        _csvOmitted: data._csvOmitted,
      }
    }
    if (data.version === 1) {
      return migrateFromV1(data)
    }
    return null
  } catch {
    return null
  }
}

export function saveWorkspace(snapshot: WorkspaceSnapshot): void {
  try {
    const str = JSON.stringify(snapshot)
    if (str.length > 4_500_000) {
      console.warn(
        'Workspace too large for localStorage; use PDF export or reduce data size.'
      )
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...snapshot,
          tabs: snapshot.tabs.map((t) => ({
            ...t,
            csvText: '',
            csvNames: [],
          })),
          _csvOmitted: true,
        })
      )
      return
    }
    localStorage.setItem(STORAGE_KEY, str)
  } catch (e) {
    console.warn('localStorage save failed', e)
  }
}

