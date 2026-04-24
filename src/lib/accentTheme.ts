import type { CSSProperties } from 'react'
import {
  APP_ACCENT_HEX,
  chartPaletteFromAccent,
  normalizeHex,
} from './chartAccent'

function parseRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex) ?? APP_ACCENT_HEX
  const h = n.slice(1)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
) {
  return {
    r: Math.max(0, Math.min(255, Math.round(a.r + (b.r - a.r) * t))),
    g: Math.max(0, Math.min(255, Math.round(a.g + (b.g - a.g) * t))),
    b: Math.max(0, Math.min(255, Math.round(a.b + (b.b - a.b) * t))),
  }
}

function toHex(c: { r: number; g: number; b: number }) {
  return (
    '#' +
    [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('')
  )
}

/**
 * Sets `--accent`, chart tokens, and hover derived for light vs dark shell.
 * Apply on `.app` so scoped overrides :root defaults from index.css.
 */
export function cssVarsForAccent(
  hex: string,
  prefersDark: boolean
): CSSProperties {
  const accent = normalizeHex(hex) ?? APP_ACCENT_HEX
  const acc = parseRgb(accent)
  const hover = prefersDark
    ? toHex(mixRgb(acc, { r: 255, g: 255, b: 255 }, 0.22))
    : toHex(mixRgb(acc, { r: 0, g: 0, b: 0 }, 0.14))
  const chart2 = toHex(mixRgb(acc, { r: 0, g: 0, b: 0 }, prefersDark ? 0.06 : 0.16))
  const chart3 = toHex(
    mixRgb(acc, { r: 255, g: 255, b: 255 }, prefersDark ? 0.14 : 0.32)
  )
  const pal = chartPaletteFromAccent(accent)
  return {
    '--accent': accent,
    '--accent-hover': hover,
    '--chart-1': accent,
    '--chart-2': chart2,
    '--chart-3': chart3,
    '--chart-hover': pal.hoverRgba,
  } as CSSProperties
}
