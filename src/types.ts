export type FieldBinding = {
  id: string
  column: string
  required: boolean
}

/** How funnel progression judges this step (multiple CSV columns on one “page”). */
export type FlowStepCompletionRule = 'allRequired' | 'anyFilled'

export type FlowStep = {
  id: string
  label: string
  fields: FieldBinding[]
  /**
   * Funnel completion: `allRequired` = every required mapped column must have an answer (default).
   * `anyFilled` = at least one mapped column has an answer—use when branching puts different
   * columns on the same conceptual question (e.g. several “program of interest” variants).
   */
  completionRule?: FlowStepCompletionRule
}

/** When true, that section is collapsed. Omitted/false = expanded. */
export type TabCollapsedPanels = {
  csv?: boolean
  variant?: boolean
  flow?: boolean
  insights?: boolean
}

export type AnalysisTab = {
  id: string
  title: string
  /** Raw CSV for this tab only (persisted in workspace). */
  csvText: string
  /** Source filename(s) for this tab’s upload. */
  csvNames: string[]
  /** Halda “Review” .docx used to auto-build the flow (filename only). */
  reviewDocName?: string
  variantColumn: string
  variantValue: string
  steps: FlowStep[]
  insightsText: string
  recommendationsText: string
  collapsedPanels?: TabCollapsedPanels
}

export type ParsedDataset = {
  headers: string[]
  rows: Record<string, string>[]
}

export type FunnelStepStats = {
  stepIndex: number
  label: string
  /** Leads who completed this question and all prior questions (required answers, in order). */
  completedCount: number
  cumulativeRate: number
  incrementalDropPct: number | null
}

export type FunnelResult = {
  /** Row count in this view (optional variant filter); partial / in-progress captures. */
  partialLeads: number
  topIncrementalDropStep: { label: string; pct: number; fromCount: number } | null
  /** Index into `steps` for that row; aligns drop chart highlight with KPI / funnel table incremental %. */
  topIncrementalDropStepIndex: number | null
  steps: FunnelStepStats[]
}

export const DEFAULT_META = {
  variant: 'Variant Name',
} as const
