import React, { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'

// fcose packs nodes far better than the built-in cose, which collapsed this
// graph into overlapping blobs at low zoom.
cytoscape.use(fcose)
import {
  PILLARS,
  PILLAR_COLORS,
  KIND_COLORS,
  formatNumber,
  formatPct,
  momentumAt,
} from '../data.js'

const EDGE_STYLE = {
  pillar_membership: { line: 'solid', color: '#2b3648' },
  paper_citation: { line: 'solid', color: '#3b82f6' },
  package_dependency: { line: 'dashed', color: '#f59e0b' },
  repo_package: { line: 'dotted', color: '#10b981' },
  trademark_company: { line: 'dotted', color: '#ef4444' },
  arxiv_openalex: { line: 'solid', color: '#a855f7' },
}

/** Pillar hubs are synthetic — they are not rows in silver_nodes. */
function pillarHubId(pillar) {
  return `pillar:${pillar}`
}

export default function GraphExplorer({ snapshot }) {
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [showMembership, setShowMembership] = useState(true)
  const [showRelations, setShowRelations] = useState(true)
  // 1,015 nodes at once is an unreadable blob. Default to one pillar; 'all' is
  // available but the layout is much denser.
  const [pillarFilter, setPillarFilter] = useState(PILLARS[0].id)

  const dates = useMemo(() => {
    const s = new Set()
    for (const n of snapshot.nodes) for (const p of n.series) s.add(p.date)
    return [...s].sort()
  }, [snapshot])

  // Slider is notched to the most recent 10 observation days.
  const windowDates = useMemo(() => dates.slice(-10), [dates])
  const [dateIdx, setDateIdx] = useState(windowDates.length - 1)
  const currentDate = windowDates[dateIdx] || dates[dates.length - 1]

  /** Build the element set for the current date. */
  const elements = useMemo(() => {
    const els = []

    // Only nodes observed on or before the current date, and matching the
    // pillar filter when one is set.
    const visible = snapshot.nodes.filter(
      (n) =>
        n.series.some((p) => p.date <= currentDate) &&
        (pillarFilter === 'all' || n.pillars.includes(pillarFilter))
    )
    const visibleIds = new Set(visible.map((n) => n.id))

    // Pillar hubs, sized by how many entities they hold right now.
    const hubCounts = {}
    for (const n of visible) {
      for (const p of n.pillars) hubCounts[p] = (hubCounts[p] || 0) + 1
    }
    for (const [pillar, count] of Object.entries(hubCounts)) {
      const meta = PILLARS.find((p) => p.id === pillar)
      els.push({
        data: {
          id: pillarHubId(pillar),
          label: meta ? meta.label : pillar,
          type: 'hub',
          color: PILLAR_COLORS[pillar] || '#64748b',
          size: 26 + Math.sqrt(count) * 3,
          count,
        },
      })
    }

    // Entity nodes. Colour = momentum, size = scale.
    for (const n of visible) {
      const mom = momentumAt(n, currentDate, 7)
      const latest = {}
      for (const p of n.series) {
        if (p.date > currentDate) continue
        if (!latest[p.metric] || p.date > latest[p.metric].date) latest[p.metric] = p
      }
      const scale = Math.max(0, ...Object.values(latest).map((p) => p.value || 0))

      // Momentum drives colour: green up, red down, grey unknown.
      let color = '#64748b'
      if (mom) color = mom.pct >= 0 ? '#10b981' : '#ef4444'

      els.push({
        data: {
          id: n.id,
          label: n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label,
          type: 'entity',
          kind: n.kind,
          source: n.source,
          pillars: n.pillars,
          color,
          kindColor: KIND_COLORS[n.kind] || '#64748b',
          // Capped small: at ~180 nodes the layout cannot guarantee spacing
          // greater than a large node's diameter, so oversized nodes overlap and
          // steal each other's clicks. Small nodes + hover labels read better.
          size: Math.min(14, 5 + Math.sqrt(scale) * 0.12),
          momentum: mom ? mom.pct : null,
          scale,
        },
      })
    }

    // Edges.
    for (const e of snapshot.edges) {
      const isMembership = e.type === 'pillar_membership'
      if (isMembership && !showMembership) continue
      if (!isMembership && !showRelations) continue

      const src = e.source
      const dst = e.target
      if (!visibleIds.has(src)) continue
      // Membership targets are hubs; other targets must be visible entities.
      if (isMembership) {
        if (!els.some((x) => x.data.id === dst)) continue
      } else if (!visibleIds.has(dst)) {
        continue
      }

      const style = EDGE_STYLE[e.type] || { line: 'solid', color: '#334155' }
      els.push({
        data: {
          id: e.id,
          source: src,
          target: dst,
          type: e.type,
          color: style.color,
          line: style.line,
        },
      })
    }

    return els
  }, [snapshot, currentDate, showMembership, showRelations, pillarFilter])

  // Create the Cytoscape instance once.
  useEffect(() => {
    if (!containerRef.current || cyRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: 'node[type="hub"]',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.22,
            'border-width': 2,
            'border-color': 'data(color)',
            label: 'data(label)',
            color: '#e6edf7',
            'font-size': 11,
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            width: 'data(size)',
            height: 'data(size)',
          },
        },
        {
          selector: 'node[type="entity"]',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.85,
            'border-width': 1,
            'border-color': 'data(kindColor)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#8b98ad',
            'font-size': 8,
            'text-valign': 'bottom',
            'text-margin-y': 3,
            'text-opacity': 0,
            'min-zoomed-font-size': 0,
          },
        },
        {
          selector: 'node[type="entity"]:hover',
          style: { 'text-opacity': 1, 'border-width': 2 },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#ffffff' },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': 'data(color)',
            'line-style': 'data(line)',
            'curve-style': 'haystack',
            opacity: 0.55,
          },
        },
        {
          selector: 'edge[type="pillar_membership"]',
          style: { opacity: 0.25, width: 0.8 },
        },
        {
          selector: 'edge:selected',
          style: { opacity: 1, width: 2 },
        },
      ],
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      minZoom: 0.08,
      maxZoom: 4,
    })

    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data()
      if (d.type === 'hub') {
        setSelected({ hub: true, ...d })
      } else {
        setSelected({ hub: false, ...d })
      }
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // Re-render elements when the date or filters change.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().remove()
    cy.add(elements)

    // fcose produces a much tighter, more even layout than cose. `nodeSeparation`
    // is the key knob: it must exceed node diameter at the resulting zoom, or
    // adjacent nodes overlap and clicks land on the wrong one.
    // `randomize: true` is REQUIRED here. Elements are re-added on every date
    // or filter change, and freshly added nodes all start at (0,0) — with
    // randomize:false the layout has no spread to work from and leaves nodes
    // stacked on identical coordinates, so clicks hit the wrong one.
    cy.layout({
      name: 'fcose',
      animate: false,
      randomize: true,
      quality: 'default',
      // nodeSeparation only applies BETWEEN disconnected components; spacing
      // within a component comes from nodeRepulsion and idealEdgeLength.
      nodeSeparation: 75,
      idealEdgeLength: 60,
      nodeRepulsion: 20000,
      gravity: 0.2,
      numIter: 2500,
      fit: true,
      padding: 40,
    }).run()

    // Zoom floor. `fit` shrinks until the whole graph is visible, which at ~180
    // nodes puts neighbours closer than a node's own diameter — clicks then hit
    // whatever is drawn on top. Better to show part of the graph at a readable
    // scale and let the user pan than to show all of it unreadably.
    const MIN_ZOOM = 0.55
    if (cy.zoom() < MIN_ZOOM) {
      cy.zoom(MIN_ZOOM)
      cy.center()
    }
  }, [elements])

  // Nodes carry type 'entity' or 'hub'; edges carry their edge_type. Counting
  // on the presence of `source` is unambiguous — only edges have one.
  const entityCount = elements.filter((e) => e.data.type === 'entity').length
  const edgeCount = elements.filter((e) => e.data.source !== undefined).length

  return (
    <div className="graph-wrap">
      <div className="graph-controls">
        <div className="slider-wrap">
          <span className="muted" style={{ fontSize: 12 }}>
            {windowDates[0]}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, windowDates.length - 1)}
            value={dateIdx}
            onChange={(e) => setDateIdx(Number(e.target.value))}
            // Notches: one step per observation day.
            step={1}
            list="date-notches"
          />
          <datalist id="date-notches">
            {windowDates.map((d, i) => (
              <option key={d} value={i} label={d} />
            ))}
          </datalist>
          <span className="muted" style={{ fontSize: 12 }}>
            {windowDates[windowDates.length - 1]}
          </span>
          <span className="date-label">{currentDate}</span>
        </div>

        <select
          value={pillarFilter}
          onChange={(e) => setPillarFilter(e.target.value)}
          style={{
            background: 'var(--panel-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 12,
          }}
        >
          {PILLARS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="all">All pillars</option>
        </select>

        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showMembership}
            onChange={(e) => setShowMembership(e.target.checked)}
          />
          Pillar links
        </label>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showRelations}
            onChange={(e) => setShowRelations(e.target.checked)}
          />
          Relationships
        </label>
        <span className="meta">
          {entityCount} nodes · {edgeCount} edges
        </span>
      </div>

      <div ref={containerRef} className="graph-canvas" />

      <div className="legend">
        <div className="legend-row">
          <span className="dot" style={{ background: '#10b981' }} />
          <span>Rising</span>
        </div>
        <div className="legend-row">
          <span className="dot" style={{ background: '#ef4444' }} />
          <span>Falling</span>
        </div>
        <div className="legend-row">
          <span className="dot" style={{ background: '#64748b' }} />
          <span>No history</span>
        </div>
        <div style={{ height: 8 }} />
        <div className="legend-row">
          <span className="line-sample" />
          <span>Citation</span>
        </div>
        <div className="legend-row">
          <span className="line-sample dashed" />
          <span>Dependency</span>
        </div>
        <div className="legend-row">
          <span className="line-sample dotted" />
          <span>Repo → package</span>
        </div>
      </div>

      {selected && (
        <div className="inspector">
          <button className="close-btn" onClick={() => setSelected(null)}>
            ×
          </button>
          <h3>{selected.label}</h3>
          <div className="kind">
            {selected.hub ? 'pillar hub' : `${selected.kind} · ${selected.source}`}
          </div>

          {selected.hub ? (
            <>
              <div className="kv">
                <span className="k">Entities</span>
                <span className="v">{selected.count}</span>
              </div>
              <div className="kv">
                <span className="k">As of</span>
                <span className="v mono">{currentDate}</span>
              </div>
            </>
          ) : (
            <>
              <div className="kv">
                <span className="k">Momentum</span>
                <span className={`v ${selected.momentum >= 0 ? 'up' : 'down'}`}>
                  {selected.momentum === null ? '—' : formatPct(selected.momentum)}
                </span>
              </div>
              <div className="kv">
                <span className="k">Scale</span>
                <span className="v">{formatNumber(selected.scale)}</span>
              </div>
              <div className="kv">
                <span className="k">As of</span>
                <span className="v mono">{currentDate}</span>
              </div>
              <div style={{ marginTop: 12 }}>
                {(selected.pillars || []).map((p) => (
                  <span
                    key={p}
                    className="chip"
                    style={{ borderColor: PILLAR_COLORS[p] }}
                  >
                    {p}
                  </span>
                ))}
              </div>
              <div className="mono muted" style={{ marginTop: 12, wordBreak: 'break-all', fontSize: 10 }}>
                {selected.id}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
