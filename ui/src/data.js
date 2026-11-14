/**
 * Data layer.
 *
 * Development reads a JSON snapshot exported by scripts/export_ui_data.py.
 * Production (Databricks App) should swap `loadSnapshot` for a SQL warehouse
 * query against the same tables — the shape below is the contract.
 */

const SNAPSHOT_URL = '/data/snapshot.json'

export const PILLARS = [
  { id: 'self-hosted-vs-saas', label: 'Self-hosted vs SaaS' },
  { id: 'temporal-memory', label: 'Temporal Memory' },
  { id: 'retrieval-engines', label: 'Retrieval Strategy' },
  { id: 'data-persistence', label: 'Durable State' },
  { id: 'stack-structure', label: 'Open Format vs Platform' },
]

export const PILLAR_COLORS = {
  'self-hosted-vs-saas': '#4f8ef7',
  'temporal-memory': '#a855f7',
  'retrieval-engines': '#10b981',
  'data-persistence': '#f59e0b',
  'stack-structure': '#ef4444',
}

export const KIND_COLORS = {
  paper: '#60a5fa',
  repo: '#34d399',
  package: '#fbbf24',
  model: '#c084fc',
  trademark: '#f87171',
}

export async function loadSnapshot() {
  const res = await fetch(SNAPSHOT_URL)
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`)
  return res.json()
}

/** All observation dates present in the snapshot, ascending. */
export function allDates(snapshot) {
  const set = new Set()
  for (const v of snapshot.volume) set.add(v.date)
  for (const n of snapshot.nodes) {
    for (const p of n.series) set.add(p.date)
  }
  return [...set].sort()
}

/** Nodes seen on or before `date`, with their metric value as of that date. */
export function nodesAt(snapshot, date) {
  const out = []
  for (const n of snapshot.nodes) {
    const points = n.series.filter((p) => p.date <= date)
    if (!points.length) continue
    // Latest point per metric on or before the date.
    const latest = {}
    for (const p of points) {
      if (!latest[p.metric] || p.date > latest[p.metric].date) latest[p.metric] = p
    }
    out.push({ ...n, asOf: latest })
  }
  return out
}

/**
 * Momentum as of `date`, measured over the preceding `windowDays`.
 * Returns a percentage, or null when there is not enough history.
 */
export function momentumAt(node, date, windowDays = 7) {
  const byMetric = {}
  for (const p of node.series) {
    if (p.date > date) continue
    ;(byMetric[p.metric] ||= []).push(p)
  }

  // Dates are plain YYYY-MM-DD strings. Parse them as UTC and do the arithmetic
  // in UTC — `new Date('2026-11-14')` is UTC midnight, so using local-time
  // getters/setters can shift the cutoff by a day.
  const cutoff = new Date(`${date}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  let best = null
  for (const [metric, points] of Object.entries(byMetric)) {
    points.sort((a, b) => (a.date < b.date ? -1 : 1))
    const last = points[points.length - 1]
    const first = points.find((p) => p.date >= cutoffStr)
    if (!first || first.value <= 0 || first === last) continue
    const pct = ((last.value - first.value) / first.value) * 100
    if (!best || Math.abs(pct) > Math.abs(best.pct)) {
      best = { pct, metric, from: first.value, to: last.value }
    }
  }
  return best
}

export function formatNumber(v) {
  if (v === null || v === undefined) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
}

export function formatPct(v) {
  if (v === null || v === undefined) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}
