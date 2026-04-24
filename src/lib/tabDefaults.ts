import { DEFAULT_META, type AnalysisTab } from '../types'
import { newId } from './id'

export function createDefaultTab(headers: string[], index: number): AnalysisTab {
  return {
    id: newId(),
    title: `Form ${index + 1}`,
    csvText: '',
    csvNames: [],
    reviewDocName: undefined,
    variantColumn: headers.includes(DEFAULT_META.variant)
      ? DEFAULT_META.variant
      : '',
    variantValue: '',
    steps: [],
    insightsText: '',
    recommendationsText: '',
    collapsedPanels: { variant: true },
  }
}
