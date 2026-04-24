import { useEffect, useRef, useState } from 'react'
import type { AnalysisTab } from '../types'
import { PencilIcon } from './PencilIcon'

type Props = {
  tabs: AnalysisTab[]
  activeTabId: string
  onSelectTab: (id: string) => void
  onUpdateTabTitle: (id: string, title: string) => void
  onRemoveTab: (id: string) => void
  onAddTab: () => void
  onDownloadAllTabsPdf?: () => void
  downloadAllPdfDisabled?: boolean
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onUpdateTabTitle,
  onRemoveTab,
  onAddTab,
  onDownloadAllTabsPdf,
  downloadAllPdfDisabled = true,
}: Props) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTabId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingTabId])

  useEffect(() => {
    if (editingTabId && editingTabId !== activeTabId) {
      setEditingTabId(null)
    }
  }, [activeTabId, editingTabId])

  function beginEdit(t: AnalysisTab) {
    onSelectTab(t.id)
    setEditingTabId(t.id)
    setDraft(t.title)
  }

  function save() {
    if (!editingTabId) return
    onUpdateTabTitle(editingTabId, draft.trim())
    setEditingTabId(null)
  }

  function cancel() {
    setEditingTabId(null)
  }

  return (
    <nav className="tab-bar" aria-label="Form analyses">
      {tabs.map((t) => {
        const isActive = t.id === activeTabId
        const isEditing = t.id === editingTabId
        const label = t.title?.trim() || 'Untitled'

        if (isEditing) {
          return (
            <div
              key={t.id}
              className="tab-btn active tab-btn-edit"
              role="tab"
              aria-selected
            >
              <input
                ref={inputRef}
                className="tab-title-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Tab title"
                aria-label="Tab title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  }
                  if (e.key === 'Escape') cancel()
                }}
              />
              <button
                type="button"
                className="tab-mini-icon tab-mini-save"
                aria-label="Save tab title"
                onClick={save}
              >
                ✓
              </button>
              <button
                type="button"
                className="tab-mini-icon tab-mini-cancel"
                aria-label="Cancel"
                onClick={cancel}
              >
                ✕
              </button>
            </div>
          )
        }

        if (isActive) {
          return (
            <div
              key={t.id}
              className="tab-btn active tab-btn-with-tools"
              role="tab"
              aria-selected
            >
              <span className="tab-btn-label">{label}</span>
              <button
                type="button"
                className="tab-icon-btn"
                aria-label="Rename tab"
                onClick={() => beginEdit(t)}
              >
                <PencilIcon className="tab-pencil-svg" />
              </button>
              <button
                type="button"
                className="tab-icon-btn tab-icon-danger"
                aria-label="Remove tab"
                onClick={() => onRemoveTab(t.id)}
              >
                ×
              </button>
            </div>
          )
        }

        return (
          <button
            key={t.id}
            type="button"
            className="tab-btn"
            role="tab"
            aria-selected={false}
            onClick={() => {
              setEditingTabId(null)
              onSelectTab(t.id)
            }}
          >
            {label}
          </button>
        )
      })}
      <button type="button" className="tab-add" onClick={onAddTab}>
        + Tab
      </button>
      {onDownloadAllTabsPdf ? (
        <button
          type="button"
          className="tab-add tab-add-pdf"
          disabled={downloadAllPdfDisabled}
          title="One PDF: every tab that has data for your checked sections"
          onClick={() => onDownloadAllTabsPdf()}
        >
          Export All To PDF
        </button>
      ) : null}
    </nav>
  )
}
