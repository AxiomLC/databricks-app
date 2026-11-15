import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PILLAR_COLORS, formatNumber, formatPct, momentumAt } from '../data.js'

/**
 * Viewer — RIGHT panel. The single results surface for the graph.
 *
 * Modelled on the Frontal Lobe Viewer: a TIMELINE of content states rather than
 * a pile of booleans.
 *
 *   state kinds
 *     · { kind: 'node',    node }              one entity's detail
 *     · { kind: 'results', query, rows }       a search result list
 *     · { kind: 'genie',   question, answer }  a Genie answer (API path only)
 *
 *   rules (same as Frontal Lobe)
 *     · consecutive duplicate node clicks are deduped
 *     · a new push after Back truncates the forward path
 *     · capped at 50 entries
 *     · Back is pure state restore — it never re-runs a query and never moves
 *       the graph
 *
 * Selecting a result row calls onNavigate, which moves the graph to that node
 * and pushes a 'node' state. The Viewer never mutates the graph itself.
 */

const CAP = 50

export default function Viewer({ push, onNavigate, currentDate, onClose }) {
  const [hist, setHist] = useState({ stack: [], idx: -1 })
  const [full, setFull] = useState(false)

  // App-initiated pushes (graph click, result-row select, Genie answer).
  useEffect(() => {
    if (!push?.kind) return
    setHist((h) => {
      const prev = h.stack[h.idx]
      const same =
        prev &&
        push.kind === 'node' &&
        prev.kind === 'node' &&
        prev.node?.id === push.node?.id
      if (same) return h
      const stack = [...h.stack.slice(0, h.idx + 1), push].slice(-CAP)
      return { stack, idx: Math.min(h.idx + 1, stack.length - 1) }
    })
  }, [push])

  const current = hist.idx >= 0 ? hist.stack[hist.idx] : null
  const back = useCallback(() => {
    setHist((h) => (h.idx <= 0 ? h : { ...h, idx: h.idx - 1 }))
  }, [])

  const node = current?.kind === 'node' ? current.node : null

  // Momentum is recomputed here from the snapshot series so the Viewer stays
  // correct when the date slider moves without a new push.
  const momentum = useMemo(() => {
    if (!node?.series) return null
    return momentumAt(node, currentDate, 7)
  }, [node, currentDate])

  if (!current) {
    return (
      <div className={`viewer${full ? ' full' : ''}`}>
        <div className="viewer-head">
          <span className="viewer-title">Viewer</span>
          <div className="viewer-actions">
            <button className="mini-btn" onClick={() => setFull((v) => !v)} title="Toggle width">
              ⛶
            </button>
            {onClose && (
              <button className="mini-btn" onClick={onClose} title="Hide">
                ×
              </button>
            )}
          </div>
        </div>
        <div className="viewer-empty">
          Click a node, or a search result, to inspect it here.
        </div>
      </div>
    )
  }

  return (
    <div className={`viewer${full ? ' full' : ''}`}>
      <div className="viewer-head">
        <button
          className="mini-btn"
          onClick={back}
          disabled={hist.idx <= 0}
          title="Back (state restore only)"
        >
          ←
        </button>
        <span className="viewer-title">
          {current.kind === 'node'
            ? current.node?.type === 'hub'
              ? 'Pillar hub'
              : 'Node'
            : current.kind === 'results'
              ? 'Results'
              : 'Genie'}
        </span>
        <div className="viewer-actions">
          <span className="viewer-depth">
            {hist.idx + 1}/{hist.stack.length}
          </span>
          <button className="mini-btn" onClick={() => setFull((v) => !v)} title="Toggle width">
            ⛶
          </button>
          {onClose && (
            <button className="mini-btn" onClick={onClose} title="Hide">
              ×
            </button>
          )}
        </div>
      </div>

      <div className="viewer-body">
        {current.kind === 'node' && (
          <NodeView node={current.node} momentum={momentum} currentDate={currentDate} />
        )}

        {current.kind === 'results' && (
          <ResultsView
            query={current.query}
            rows={current.rows || []}
            onPick={(row) => onNavigate?.(row)}
          />
        )}

        {current.kind === 'genie' && (
          <GenieAnswerView question={current.question} answer={current.answer} />
        )}
      </div>
    </div>
  )
}

function NodeView({ node, momentum, currentDate }) {
  if (node.type === 'hub') {
    return (
      <>
        <h3 className="viewer-h3">{node.label}</h3>
        <div className="viewer-kind">pillar hub</div>
        <div className="kv">
          <span className="k">Entities</span>
          <span className="v">{node.count}</span>
        </div>
        <div className="kv">
          <span className="k">As of</span>
          <span className="v mono">{currentDate}</span>
        </div>
      </>
    )
  }

  return (
    <>
      <h3 className="viewer-h3">{node.label}</h3>
      <div className="viewer-kind">
        {node.kind} · {node.source}
      </div>

      <div className="kv">
        <span className="k">Momentum</span>
        <span className={`v ${momentum && momentum.pct >= 0 ? 'up' : 'down'}`}>
          {momentum ? formatPct(momentum.pct) : '—'}
        </span>
      </div>
      <div className="kv">
        <span className="k">Scale</span>
        <span className="v">{formatNumber(node.scale)}</span>
      </div>
      <div className="kv">
        <span className="k">As of</span>
        <span className="v mono">{currentDate}</span>
      </div>

      {momentum && (
        <div className="kv">
          <span className="k">Window</span>
          <span className="v mono">
            {formatNumber(momentum.from)} → {formatNumber(momentum.to)}
          </span>
        </div>
      )}

      <div className="viewer-chips">
        {(node.pillars || []).map((p) => (
          <span key={p} className="chip" style={{ borderColor: PILLAR_COLORS[p] }}>
            {p}
          </span>
        ))}
      </div>

      <div className="viewer-id mono">{node.id}</div>
    </>
  )
}

function ResultsView({ query, rows, onPick }) {
  if (!rows.length) {
    return (
      <>
        <div className="viewer-query">{query}</div>
        <div className="viewer-empty">No matches.</div>
      </>
    )
  }
  return (
    <>
      <div className="viewer-query">
        {query} · {rows.length} result{rows.length === 1 ? '' : 's'}
      </div>
      <ul className="result-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button className="result-row" onClick={() => onPick(r)}>
              <span className="result-label">{r.label}</span>
              <span className="result-meta">
                {r.kind} · {r.source}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function GenieAnswerView({ question, answer }) {
  return (
    <>
      <div className="viewer-query">{question}</div>
      {answer?.sql && (
        <pre className="genie-sql">
          <code>{answer.sql}</code>
        </pre>
      )}
      <div className="genie-answer">{answer?.text || 'No answer yet.'}</div>
    </>
  )
}
