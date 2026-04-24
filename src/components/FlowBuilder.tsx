import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FlowStep, FieldBinding } from '../types'
import { newId } from '../lib/id'
import { AddColumnPicker, ColumnSearchCombo } from './ColumnSearchPicker'
import { PencilIcon } from './PencilIcon'

type Props = {
  headers: string[]
  steps: FlowStep[]
  onChange: (steps: FlowStep[]) => void
}

function usedColumns(steps: FlowStep[]): Set<string> {
  const s = new Set<string>()
  for (const st of steps) {
    for (const f of st.fields) {
      if (f.column) s.add(f.column)
    }
  }
  return s
}

function SortableStepCard({
  step,
  headers,
  used,
  onUpdateStep,
  onRemoveStep,
  onMoveField,
  onRemoveField,
  onAddField,
}: {
  step: FlowStep
  headers: string[]
  used: Set<string>
  onUpdateStep: (id: string, patch: Partial<FlowStep>) => void
  onRemoveStep: (id: string) => void
  onMoveField: (
    stepId: string,
    fieldId: string,
    dir: -1 | 1
  ) => void
  onRemoveField: (stepId: string, fieldId: string) => void
  onAddField: (stepId: string, column: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  }

  const availableForAdd = headers.filter((h) => !used.has(h))

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(step.label)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingTitle) setTitleDraft(step.label)
  }, [step.label, editingTitle])

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingTitle])

  function saveStepTitle() {
    onUpdateStep(step.id, { label: titleDraft.trim() })
    setEditingTitle(false)
  }

  function cancelStepTitle() {
    setTitleDraft(step.label)
    setEditingTitle(false)
  }

  const titleDisplay = step.label.trim() || 'Untitled question'

  return (
    <div ref={setNodeRef} style={style} className="flow-step card">
      <div className="flow-step-head">
        <button
          type="button"
          className="drag-handle"
          aria-label="Drag to reorder question"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        {editingTitle ? (
          <div className="flow-step-title-edit">
            <input
              ref={titleInputRef}
              className="tab-title-input flow-step-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Question title"
              aria-label="Question title"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveStepTitle()
                }
                if (e.key === 'Escape') cancelStepTitle()
              }}
            />
            <button
              type="button"
              className="tab-mini-icon tab-mini-save"
              aria-label="Save question title"
              onClick={saveStepTitle}
            >
              ✓
            </button>
            <button
              type="button"
              className="tab-mini-icon tab-mini-cancel"
              aria-label="Cancel"
              onClick={cancelStepTitle}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flow-step-title-tools">
            <span
              className={`flow-step-title-label ${step.label.trim() ? '' : 'is-placeholder'}`}
            >
              {titleDisplay}
            </span>
            <button
              type="button"
              className="tab-icon-btn"
              aria-label="Rename question"
              onClick={() => {
                setTitleDraft(step.label)
                setEditingTitle(true)
              }}
            >
              <PencilIcon className="tab-pencil-svg" />
            </button>
            <button
              type="button"
              className="tab-icon-btn tab-icon-danger"
              aria-label="Remove question"
              onClick={() => onRemoveStep(step.id)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <details className="flow-completion-details">
        <summary className="flow-completion-summary">
          <span className="flow-completion-summary-title">
            Funnel completion
          </span>
          {(step.completionRule ?? 'allRequired') === 'anyFilled' ? (
            <span className="flow-completion-summary-badge">Any column</span>
          ) : null}
        </summary>
        <div className="flow-completion-block">
          <label
            className="flow-completion-label"
            htmlFor={`completion-${step.id}`}
          >
            Count this step complete when
          </label>
          <select
            id={`completion-${step.id}`}
            className="flow-completion-select"
            value={step.completionRule ?? 'allRequired'}
            onChange={(e) =>
              onUpdateStep(step.id, {
                completionRule:
                  e.target.value === 'anyFilled' ? 'anyFilled' : 'allRequired',
              })
            }
          >
            <option value="allRequired">
              All required columns are answered
            </option>
            <option value="anyFilled">
              Any column has an answer (group branching columns)
            </option>
          </select>
          {(step.completionRule ?? 'allRequired') === 'anyFilled' ? (
            <p className="flow-completion-hint">
              Use with several mappings on this question (e.g. different
              program-of-interest columns per path). Drop-off reflects anyone who
              didn’t fill <em>any</em> of them before leaving.
            </p>
          ) : null}
        </div>
      </details>
      <ul className="field-list">
        {step.fields.map((field, idx) => (
          <li key={field.id} className="field-row">
            <ColumnSearchCombo
              options={headers}
              value={field.column}
              allowEmptyOption
              emptyOptionLabel="Select column…"
              onChange={(col) => {
                onUpdateStep(step.id, {
                  fields: step.fields.map((f) =>
                    f.id === field.id ? { ...f, column: col } : f
                  ),
                })
              }}
            />
            <label className="req-toggle">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => {
                  onUpdateStep(step.id, {
                    fields: step.fields.map((f) =>
                      f.id === field.id
                        ? { ...f, required: e.target.checked }
                        : f
                    ),
                  })
                }}
              />
              Required
            </label>
            <button
              type="button"
              className="btn icon"
              disabled={idx === 0}
              onClick={() => onMoveField(step.id, field.id, -1)}
              aria-label="Move mapped column up"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn icon"
              disabled={idx === step.fields.length - 1}
              onClick={() => onMoveField(step.id, field.id, 1)}
              aria-label="Move mapped column down"
            >
              ↓
            </button>
            <button
              type="button"
              className="btn icon danger"
              onClick={() => onRemoveField(step.id, field.id)}
              aria-label="Remove column mapping"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flow-step-foot">
        <p className="add-column-label">Add column to this page</p>
        <AddColumnPicker
          options={availableForAdd}
          onPick={(col) => onAddField(step.id, col)}
        />
      </div>
    </div>
  )
}

export function FlowBuilder({ headers, steps, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const used = useMemo(() => usedColumns(steps), [steps])

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = steps.findIndex((s) => s.id === active.id)
    const newIndex = steps.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(steps, oldIndex, newIndex))
  }

  function onUpdateStep(id: string, patch: Partial<FlowStep>) {
    onChange(
      steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
    )
  }

  function onRemoveStep(id: string) {
    onChange(steps.filter((s) => s.id !== id))
  }

  function onAddStep() {
    onChange([
      ...steps,
      {
        id: newId(),
        label: `Question ${steps.length + 1}`,
        fields: [],
      },
    ])
  }

  function onAddField(stepId: string, column: string) {
    const binding: FieldBinding = {
      id: newId(),
      column,
      required: true,
    }
    onChange(
      steps.map((s) =>
        s.id === stepId ? { ...s, fields: [...s.fields, binding] } : s
      )
    )
  }

  function onRemoveField(stepId: string, fieldId: string) {
    onChange(
      steps.map((s) =>
        s.id === stepId
          ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) }
          : s
      )
    )
  }

  function onMoveField(
    stepId: string,
    fieldId: string,
    dir: -1 | 1
  ) {
    onChange(
      steps.map((s) => {
        if (s.id !== stepId) return s
        const i = s.fields.findIndex((f) => f.id === fieldId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= s.fields.length) return s
        const nf = [...s.fields]
        ;[nf[i], nf[j]] = [nf[j]!, nf[i]!]
        return { ...s, fields: nf }
      })
    )
  }

  return (
    <div className="flow-builder">
      <p className="hint">
        Each question is one page in order (matches Halda review screens when
        you import a review .docx). Put related columns on the same step—for
        example several “program of interest” fields from different branches—then
        choose <strong>Any column has an answer</strong> so the funnel treats them
        as one drop-off point without skip logic.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={steps.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flow-steps">
            {steps.map((step) => (
              <SortableStepCard
                key={step.id}
                step={step}
                headers={headers}
                used={used}
                onUpdateStep={onUpdateStep}
                onRemoveStep={onRemoveStep}
                onMoveField={onMoveField}
                onRemoveField={onRemoveField}
                onAddField={onAddField}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button type="button" className="btn secondary" onClick={onAddStep}>
        + Add question
      </button>
    </div>
  )
}
