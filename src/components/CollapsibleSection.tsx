import { useId, type ReactNode } from 'react'

type Props = {
  title: string
  /** Shown when collapsed (e.g. current value preview). */
  summary?: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}

export function CollapsibleSection({
  title,
  summary,
  collapsed,
  onToggle,
  children,
  className = '',
}: Props) {
  const uid = useId()
  const bodyId = `${uid}-body`

  return (
    <section
      className={`collapsible panel ${className}`.trim()}
      data-collapsed={collapsed}
    >
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="collapsible-chevron" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="collapsible-title">{title}</span>
        {collapsed && summary ? (
          <span className="collapsible-summary">{summary}</span>
        ) : null}
      </button>
      {!collapsed ? (
        <div id={bodyId} className="collapsible-body">
          {children}
        </div>
      ) : null}
    </section>
  )
}
