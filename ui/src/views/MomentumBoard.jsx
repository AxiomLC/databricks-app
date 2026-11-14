import React, { useMemo, useState } from 'react'
import {
  PILLARS,
  PILLAR_COLORS,
  formatNumber,
  formatPct,
  momentumAt,
} from '../data.js'

/** Tiny inline sparkline — no chart library needed for a handful of points. */
function Spark({ points, color }) {
  if (!points || points.length < 2) return null
  const vals = points.map((p) => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const w = 100
  const h = 40
  const step = w / (points.length - 1)
  const d = points
    .map((p, i) => {
      const x = i * step
      const y = h - ((p.value - min) / span) * (h - 4) - 2
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default function MomentumBoard({ snapshot }) {
  const [sortBy, setSortBy] = useState('momentum')

  const dates = useMemo(() => {
    const s = new Set()
    for (const n of snapshot.nodes) for (const p of n.series) s.add(p.date)
    return [...s].sort()
  }, [snapshot])

  const latestDate = dates[dates.length - 1]

  /** Per-pillar rollup: entity count and median momentum of its members. */
  const pillarStats = useMemo(() => {
    return PILLARS.map((p) => {
      const members = snapshot.nodes.filter((n) => n.pillars.includes(p.id))
      const moves = members
        .map((n) => momentumAt(n, latestDate, 7))
        .filter(Boolean)
        .map((m) => m.pct)
        .sort((a, b) => a - b)

      const median = moves.length ? moves[Math.floor(moves.length / 2)] : null

      // Volume trend for this pillar across all dates.
      const byDate = {}
      for (const v of snapshot.volume) {
        if (v.pillar !== p.id) continue
        byDate[v.date] = (byDate[v.date] || 0) + (v.entityCount || 0)
      }
      const series = Object.entries(byDate)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, value]) => ({ date, value }))

      return {
        ...p,
        members: members.length,
        median,
        rising: moves.filter((m) => m > 0).length,
        falling: moves.filter((m) => m < 0).length,
        series,
      }
    })
  }, [snapshot, latestDate])

  /** Top movers across all nodes. */
  const movers = useMemo(() => {
    const rows = []
    for (const n of snapshot.nodes) {
      const m = momentumAt(n, latestDate, 7)
      if (!m) continue
      rows.push({ node: n, ...m })
    }
    rows.sort((a, b) =>
      sortBy === 'momentum'
        ? Math.abs(b.pct) - Math.abs(a.pct)
        : (b.to || 0) - (a.to || 0)
    )
    return rows.slice(0, 40)
  }, [snapshot, latestDate, sortBy])

  const bySource = useMemo(
    () =>
      Object.entries(
        snapshot.nodes.reduce((acc, n) => {
          acc[n.source] = (acc[n.source] || 0) + 1
          return acc
        }, {})
      ).sort((a, b) => b[1] - a[1]),
    [snapshot]
  )

  const byEdgeType = useMemo(
    () =>
      Object.entries(
        snapshot.edges.reduce((acc, e) => {
          acc[e.type] = (acc[e.type] || 0) + 1
          return acc
        }, {})
      ).sort((a, b) => b[1] - a[1]),
    [snapshot]
  )

  return (
    <div className="board">
      <div className="board-main">
        <h2 className="section-title">Pillars — 7-day momentum</h2>
        <div className="pillar-grid">
          {pillarStats.map((p) => (
            <div
              key={p.id}
              className="pillar-card"
              style={{ borderLeftColor: PILLAR_COLORS[p.id] }}
            >
              <h3>{p.label}</h3>
              <div className="big">
                {p.median === null ? (
                  <span className="muted">—</span>
                ) : (
                  <span className={p.median >= 0 ? 'up' : 'down'}>
                    {formatPct(p.median)}
                  </span>
                )}
              </div>
              <div className="sub">
                median · {p.members.toLocaleString()} entities ·{' '}
                <span className="up">{p.rising}↑</span>{' '}
                <span className="down">{p.falling}↓</span>
              </div>
              <Spark points={p.series} color={PILLAR_COLORS[p.id]} />
            </div>
          ))}
        </div>

        <h2 className="section-title">Top movers</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Kind</th>
              <th>Pillar</th>
              <th
                className="num"
                style={{ cursor: 'pointer' }}
                onClick={() => setSortBy('momentum')}
              >
                Momentum {sortBy === 'momentum' ? '▾' : ''}
              </th>
              <th
                className="num"
                style={{ cursor: 'pointer' }}
                onClick={() => setSortBy('size')}
              >
                Latest {sortBy === 'size' ? '▾' : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {movers.map((m) => (
              <tr key={m.node.id}>
                <td title={m.node.id}>{m.node.label.slice(0, 52)}</td>
                <td className="muted">{m.node.kind}</td>
                <td className="muted">{m.node.pillars[0] || '—'}</td>
                <td className={`num ${m.pct >= 0 ? 'up' : 'down'}`}>
                  {formatPct(m.pct)}
                </td>
                <td className="num">{formatNumber(m.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="board-side">
        <h2 className="section-title">Signal coverage</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Entities</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map(([source, count]) => (
              <tr key={source}>
                <td>{source}</td>
                <td className="num">{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="section-title" style={{ marginTop: 24 }}>
          Relationships
        </h2>
        <table className="data">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Edges</th>
            </tr>
          </thead>
          <tbody>
            {byEdgeType.map(([type, count]) => (
              <tr key={type}>
                <td>{type.replace(/_/g, ' ')}</td>
                <td className="num">{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="section-title" style={{ marginTop: 24 }}>
          Observation window
        </h2>
        <div className="kv">
          <span className="k">First</span>
          <span className="v mono">{dates[0]}</span>
        </div>
        <div className="kv">
          <span className="k">Latest</span>
          <span className="v mono">{latestDate}</span>
        </div>
        <div className="kv">
          <span className="k">Days</span>
          <span className="v">{dates.length}</span>
        </div>
      </aside>
    </div>
  )
}
