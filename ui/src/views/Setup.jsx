import React, { useMemo } from 'react'
import { PILLARS, PILLAR_COLORS } from '../data.js'

/**
 * Setup / Pillars.
 *
 * Read-only in this build. Editing pillars means writing pillars.json, which is
 * an n8n-side file — the write path needs an API endpoint that does not exist
 * yet. Showing the current state is still useful: it answers "what is this app
 * actually watching".
 */
export default function Setup({ snapshot }) {
  const perPillar = useMemo(() => {
    const out = {}
    for (const p of PILLARS) out[p.id] = { entities: 0, sources: {} }
    for (const n of snapshot.nodes) {
      for (const p of n.pillars) {
        if (!out[p]) continue
        out[p].entities += 1
        out[p].sources[n.source] = (out[p].sources[n.source] || 0) + 1
      }
    }
    return out
  }, [snapshot])

  return (
    <div className="page">
      <div className="page-inner">
        <h2>Setup / Pillars</h2>
        <p className="lede">
          The five pillars decide what gets collected. Every collector reads this
          list — changing it here would change what the whole pipeline fetches.
          Editing is not wired up yet: the source of truth is the{' '}
          <span className="mono">Pillar Keywords</span> node in n8n, which writes{' '}
          <span className="mono">pillars.json</span> at runtime.
        </p>

        {PILLARS.map((p) => {
          const stats = perPillar[p.id] || { entities: 0, sources: {} }
          const sources = Object.entries(stats.sources).sort((a, b) => b[1] - a[1])
          return (
            <div
              key={p.id}
              className="card"
              style={{ borderLeft: `3px solid ${PILLAR_COLORS[p.id]}` }}
            >
              <h3>{p.label}</h3>
              <p className="mono" style={{ marginBottom: 12 }}>
                {p.id}
              </p>
              <div className="kv">
                <span className="k">Entities tagged</span>
                <span className="v">{stats.entities.toLocaleString()}</span>
              </div>
              <div className="kv">
                <span className="k">Sources contributing</span>
                <span className="v">{sources.length}</span>
              </div>
              <div style={{ marginTop: 10 }}>
                {sources.map(([source, count]) => (
                  <span key={source} className="chip">
                    {source} · {count}
                  </span>
                ))}
              </div>
            </div>
          )
        })}

        <div className="card">
          <h3>Ingest controls</h3>
          <p>
            Per-leg on/off switches and a cron enable/disable toggle are planned.
            They need an n8n API endpoint to flip node state — the workflow is
            currently edited directly.
          </p>
          <div style={{ marginTop: 12 }}>
            <span className="badge warn">not wired</span>
          </div>
        </div>
      </div>
    </div>
  )
}
