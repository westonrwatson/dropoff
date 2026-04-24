import { useEffect, useId, useMemo, useRef, useState } from 'react'

function filterHeaders(headers: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return headers
  return headers.filter((h) => h.toLowerCase().includes(q))
}

/** Combobox for choosing a column on an existing field row. */
export function ColumnSearchCombo({
  options,
  value,
  onChange,
  placeholder = 'Select column…',
  allowEmptyOption,
  emptyOptionLabel = 'Select column…',
}: {
  options: string[]
  value: string
  onChange: (column: string) => void
  placeholder?: string
  allowEmptyOption?: boolean
  emptyOptionLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(
    () => filterHeaders(options, query),
    [options, query]
  )

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  function pick(col: string) {
    onChange(col)
    setOpen(false)
  }

  return (
    <div className="column-search-select" ref={rootRef}>
      <button
        type="button"
        className="column-search-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={
            value ? 'column-search-value' : 'column-search-placeholder'
          }
        >
          {value || placeholder}
        </span>
        <span className="column-search-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="column-search-panel" role="listbox">
          <input
            type="search"
            className="column-search-filter"
            placeholder="Search columns…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            autoFocus
            aria-label="Filter columns"
          />
          <ul className="column-search-options">
            {allowEmptyOption && (
              <li key="__empty" role="presentation">
                <button
                  type="button"
                  role="option"
                  className="column-search-option"
                  onClick={() => pick('')}
                >
                  {emptyOptionLabel}
                </button>
              </li>
            )}
            {filtered.map((h) => (
              <li key={h} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="column-search-option"
                  onClick={() => pick(h)}
                >
                  {h}
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="column-search-empty hint">No matching columns.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Search + list for adding a column to a step (only unused columns). */
export function AddColumnPicker({
  options,
  onPick,
}: {
  options: string[]
  onPick: (column: string) => void
}) {
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const filtered = useMemo(
    () => filterHeaders(options, query),
    [options, query]
  )

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setListOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (options.length === 0) {
    return (
      <p className="hint add-column-picker-empty">
        All CSV columns are already mapped in this flow.
      </p>
    )
  }

  return (
    <div className="add-column-picker" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        className="add-column-picker-search"
        placeholder="Search columns to add…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setListOpen(true)
        }}
        onFocus={() => setListOpen(true)}
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-label="Search columns to add to this page"
      />
      {listOpen && (
        <>
          <ul
            id={listboxId}
            className="add-column-picker-list"
            role="listbox"
          >
            {filtered.map((h) => (
              <li key={h} role="presentation">
                <button
                  type="button"
                  role="option"
                  className="add-column-picker-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(h)
                    setQuery('')
                    setListOpen(true)
                    queueMicrotask(() => inputRef.current?.focus())
                  }}
                >
                  {h}
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="hint">No columns match your search.</p>
          )}
        </>
      )}
    </div>
  )
}
