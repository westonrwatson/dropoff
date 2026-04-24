/** Normalize user hex to #rrggbb or null if invalid. */
export function normalizeHex(hex: string): string | null {
  const h = hex.replace(/^#/, '').trim()
  if (h.length === 3 && /^[0-9a-fA-F]{3}$/.test(h)) {
    return (
      '#' +
      h[0]! +
      h[0]! +
      h[1]! +
      h[1]! +
      h[2]! +
      h[2]!
    ).toLowerCase()
  }
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) {
    return ('#' + h).toLowerCase()
  }
  return null
}

function parseRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex) ?? '#4fabff'
  const h = n.slice(1)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex(c: { r: number; g: number; b: number }) {
  return (
    '#' +
    [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('')
  )
}

/** App-wide accent; charts and primary UI use this only. */
export const APP_ACCENT_HEX = '#4fabff'

/** Darken by scaling RGB — same hue as the accent (no black mix). */
function slightlyDeeper(
  acc: { r: number; g: number; b: number },
  factor: number
) {
  return {
    r: Math.max(0, Math.round(acc.r * factor)),
    g: Math.max(0, Math.round(acc.g * factor)),
    b: Math.max(0, Math.round(acc.b * factor)),
  }
}

/**
 * Drop chart: other bars = solid accent (#4fabff); largest incremental-drop step = a bit darker, same hue.
 */
export function chartPaletteFromAccent(hex: string) {
  const acc = parseRgb(hex)
  const accent = toHex(acc)
  return {
    reach: accent,
    dropHighlight: toHex(slightlyDeeper(acc, 0.86)),
    dropMuted: accent,
    hoverRgba: `rgba(${acc.r},${acc.g},${acc.b},0.16)`,
  }
}

/** Funnel charts on the dashboard always use the fixed app accent. */
export function chartPaletteUi() {
  return chartPaletteFromAccent(APP_ACCENT_HEX)
}
