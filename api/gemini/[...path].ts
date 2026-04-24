import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM = 'https://generativelanguage.googleapis.com'

/**
 * Proxies `/api/gemini/*` → Google Generative Language API (same contract as Vite dev proxy).
 * Appends `GEMINI_API_KEY` or `GOOGLE_API_KEY` when the client omits `?key=`.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(405).json({
      error: { message: `Method ${req.method} not allowed` },
    })
    return
  }

  const serverKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
  if (!serverKey) {
    res.status(500).json({
      error: {
        message:
          'Gemini proxy is not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in Vercel project settings.',
      },
    })
    return
  }

  const raw = req.query.path
  const segments = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : []
  const upstreamPath = '/' + segments.join('/')

  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost'
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const urlObj = new URL(req.url || '/', `${proto}://${host}`)
  const searchParams = urlObj.searchParams
  if (!searchParams.has('key')) {
    searchParams.set('key', serverKey)
  }
  const qs = searchParams.toString()
  const upstreamUrl = `${UPSTREAM}${upstreamPath}${qs ? `?${qs}` : ''}`

  const headers: Record<string, string> = {}
  const ct = req.headers['content-type']
  if (ct) headers['Content-Type'] = Array.isArray(ct) ? ct[0]! : ct

  const init: RequestInit = {
    method: req.method,
    headers,
  }
  if (req.method === 'POST') {
    init.body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
  }

  const upstream = await fetch(upstreamUrl, init)
  const outCt = upstream.headers.get('content-type') || 'application/json'
  res.status(upstream.status).setHeader('Content-Type', outCt)
  const buf = Buffer.from(await upstream.arrayBuffer())
  res.send(buf)
}
