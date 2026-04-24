import { marked } from 'marked'

marked.use({
  breaks: true,
  gfm: true,
})

/** True if string looks like HTML (TipTap / pasted markup), not plain text. */
export function isLikelyHtml(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test((s ?? '').trim())
}

function isTrailingEmptyBlock(el: Element): boolean {
  const tag = el.tagName
  if (tag !== 'P' && tag !== 'DIV') return false
  const text = (el.textContent ?? '').replace(/\u200b/g, '').trim()
  return text.length === 0
}

/** Drop trailing empty paragraphs so the editor doesn’t show an extra blank line at the bottom. */
export function trimTrailingEmptyEditorHtml(html: string): string {
  const t = html.trim()
  if (!t) return ''
  if (typeof DOMParser === 'undefined') return t

  const doc = new DOMParser().parseFromString(
    `<div id="trim-root">${t}</div>`,
    'text/html'
  )
  const root = doc.getElementById('trim-root')
  if (!root) return t

  for (;;) {
    const kids = root.children
    if (kids.length === 0) break
    const last = kids[kids.length - 1]!
    if (!isTrailingEmptyBlock(last)) break
    last.remove()
  }

  const out = root.innerHTML.trim()
  return out || '<p></p>'
}

/**
 * Markdown (e.g. AI output with **bold**, lists) → HTML for TipTap.
 * Links become plain text with URL in parentheses (no `<a>`).
 */
export function markdownToTipTapHtml(md: string): string {
  const raw = (md ?? '').trim()
  if (!raw) return ''

  const parsed = marked.parse(raw, { async: false }) as string

  if (typeof DOMParser === 'undefined') {
    const t = parsed.trim()
    return t || '<p></p>'
  }

  const doc = new DOMParser().parseFromString(
    `<div id="md-root">${parsed}</div>`,
    'text/html'
  )
  const root = doc.getElementById('md-root')
  if (!root) {
    const t = parsed.trim()
    return t || '<p></p>'
  }

  root
    .querySelectorAll('script,iframe,object,embed,link')
    .forEach((el) => el.remove())

  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href')?.trim() ?? ''
    const t = a.textContent ?? ''
    const rep = href ? `${t} (${href})` : t
    a.replaceWith(doc.createTextNode(rep))
  })

  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const p = doc.createElement('p')
    const strong = doc.createElement('strong')
    strong.textContent = h.textContent
    p.appendChild(strong)
    h.replaceWith(p)
  })

  const html = trimTrailingEmptyEditorHtml(root.innerHTML.trim())
  return html || '<p></p>'
}

/** Stored tab value → HTML for TipTap `content` / setContent. */
export function normalizeStoredToTipTapHtml(stored: string): string {
  const t = stored ?? ''
  if (!t.trim()) return ''
  if (isLikelyHtml(t)) return trimTrailingEmptyEditorHtml(t)
  return markdownToTipTapHtml(t)
}

function walkDomToPlain(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()

  if (tag === 'br') return '\n'

  if (tag === 'a') {
    const href = el.getAttribute('href')?.trim() ?? ''
    const inner = Array.from(el.childNodes).map(walkDomToPlain).join('').trim()
    if (href && inner) return `${inner} (${href})`
    if (href) return href
    return inner
  }

  if (tag === 'p') {
    const inner = Array.from(el.childNodes).map(walkDomToPlain).join('')
    return inner.trimEnd() + '\n\n'
  }

  if (tag === 'li') {
    return `• ${Array.from(el.childNodes).map(walkDomToPlain).join('').trim()}\n`
  }

  if (tag === 'ul' || tag === 'ol') {
    return Array.from(el.childNodes).map(walkDomToPlain).join('')
  }

  return Array.from(el.childNodes).map(walkDomToPlain).join('')
}

/** HTML from editor → plain text for PDF / previews. Plain input returned unchanged. */
export function richTextToPlain(source: string): string {
  const raw = source ?? ''
  if (!raw.trim()) return ''
  if (!isLikelyHtml(raw)) return raw

  const wrapper = document.createElement('div')
  wrapper.innerHTML = raw
  const out = Array.from(wrapper.childNodes).map(walkDomToPlain).join('').trim()
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
