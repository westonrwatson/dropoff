import { useEffect, useRef, useState } from 'react'

type Props = {
  schoolName: string
  onSave: (next: string) => void
}

export function SchoolNameHeader({ schoolName, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(schoolName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(schoolName)
  }, [schoolName, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function save() {
    onSave(draft.trim())
    setEditing(false)
  }

  function cancel() {
    setDraft(schoolName)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="school-name-editor">
        <input
          ref={inputRef}
          className="school-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="School / client name"
          aria-label="School or client name"
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
          className="school-name-icon school-name-save"
          aria-label="Save name"
          onClick={save}
        >
          ✓
        </button>
        <button
          type="button"
          className="school-name-icon school-name-cancel"
          aria-label="Cancel"
          onClick={cancel}
        >
          ✕
        </button>
      </div>
    )
  }

  const display = schoolName.trim()
  return (
    <button
      type="button"
      className={`school-title school-title-hit ${display ? '' : 'is-placeholder'}`}
      onClick={() => setEditing(true)}
    >
      {display || 'Add school / client name'}
    </button>
  )
}
