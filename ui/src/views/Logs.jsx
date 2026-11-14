import React, { useMemo } from 'react'

/**
 * Logs.
 *
 * The snapshot carries no execution history — that lives in n8n. What it can
 * show honestly is the *result* of each run: how many entities each source
 * contributed on each observation date. That is enough to spot a leg that
 * silently stopped returning data.
 */
export default function Logs({ snapshot }) {
  const rows = useMemo(() => {
    const byDate = {}
    for (const v of snapshot.volume) {
      byDate[v.date] ||= {}
      byDate[v.date][v.source] = (byDate[v.date][v.source] || 0) + (v.entityCount || 0)
    }
    const dates = Object.keys(byDate).sort().reverse()
    const sources = [...new Set(snapshot.volume.map((v) => v.source))].sort()
    return { byDate, dates, sources }
  }, [snapshot])

  return (
    <div className="page">
      <div className="page-inner">
        <h2>Logs</h2>
        <p className="lede">
          Entities collected per source per observation day. A source that drops
          to zero, or stops appearing entirely, is the signal that a leg broke.
          Full execution history lives in n8n.
        </p>

        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              {rows.sources.map((s) => (
                <th key={s} className="num">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.dates.map((date) => (
              <tr key={date}>
                <td className="mono">{date}</td>
                {rows.sources.map((s) => {
                  const n = rows.byDate[date][s]
                  return (
                    <td key={s} className="num">
                      {n === undefined ? (
                        <span className="muted">—</span>
                      ) : n === 0 ? (
                        <span className="down">0</span>
                      ) : (
                        n
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="card" style={{ marginTop: 24 }}>
          <h3>What is not here</h3>
          <p>
            Validation failures, gate decisions, and the Slack approval branch are
            recorded in n8n, not in Databricks. Surfacing them needs an n8n API
            read — planned, not built.
          </p>
          <div style={{ marginTop: 12 }}>
            <span className="badge warn">partial</span>
          </div>
        </div>
      </div>
    </div>
  )
}
