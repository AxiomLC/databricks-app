import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PILLARS } from '../data.js'
import {
  buildGraph,
  CY_DEFAULTS,
  CY_SCHEMA,
  FG_DEFAULTS,
  FG_SCHEMA,
} from './graphModel.js'
import CytoscapeGraph from './CytoscapeGraph.jsx'
import ParamModal from './ParamModal.jsx'
import GeniePanel from './GeniePanel.jsx'
import Viewer from './Viewer.jsx'

// force-graph pulls in d3 + lodash-es (~350 kB). Most sessions never leave
// Cytoscape, so the second engine is fetched only when it is first selected.
const ForceGraphView = lazy(() => import('./ForceGraphView.jsx'))

const ENGINES = [
  { id: 'cytoscape', label: 'Cytoscape' },
  { id: 'forcegraph', label: 'Force Graph' },
]

/** Read a JSON object from localStorage, tolerating absent/corrupt values. */
function readStored(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export default function GraphExplorer({ snapshot }) {
  const [engine, setEngine] = useState('cytoscape')
  const [selected, setSelected] = useState(null)
  const [showMembership, setShowMembership] = useState(true)
  const [showRelations, setShowRelations] = useState(true)
  // 1,015 nodes at once is an unreadable blob. Default to one pillar; 'all' is
  // available but the layout is much denser.
  const [pillarFilter, setPillarFilter] = useState(PILLARS[0].id)
  const [showParams, setShowParams] = useState(false)

  // Panels. Genie left, Viewer right — both toggleable.
  const [showGenie, setShowGenie] = useState(false)
  const [showViewer, setShowViewer] = useState(true)
  const [viewerPush, setViewerPush] = useState(null)
  const [search, setSearch] = useState('')

  // Renderers are imperative; this lets a search result move the graph.
  const graphApiRef = useRef(null)

  // Each engine keeps its own parameter set — the knobs are not comparable.
  // Params persist across reloads. Merged over the defaults so a newly added
  // knob still gets its default value instead of being undefined.
  const [cyParams, setCyParams] = useState(() => ({
    ...CY_DEFAULTS,
    ...readStored('momentum_cy_params'),
  }))
  const [fgParams, setFgParams] = useState(() => ({
    ...FG_DEFAULTS,
    ...readStored('momentum_fg_params'),
  }))

  useEffect(() => {
    localStorage.setItem('momentum_cy_params', JSON.stringify(cyParams))
  }, [cyParams])

  useEffect(() => {
    localStorage.setItem('momentum_fg_params', JSON.stringify(fgParams))
  }, [fgParams])

  const dates = useMemo(() => {
    const s = new Set()
    for (const n of snapshot.nodes) for (const p of n.series) s.add(p.date)
    return [...s].sort()
  }, [snapshot])

  // Slider is notched to the most recent 10 observation days.
  const windowDates = useMemo(() => dates.slice(-10), [dates])
  const [dateIdx, setDateIdx] = useState(windowDates.length - 1)
  const currentDate = windowDates[dateIdx] || dates[dates.length - 1]

  const graph = useMemo(
    () =>
      buildGraph({
        snapshot,
        currentDate,
        showMembership,
        showRelations,
        pillarFilter,
      }),
    [snapshot, currentDate, showMembership, showRelations, pillarFilter]
  )

  // Graph click → Viewer node state. Kept separate from `selected` so the
  // inspector-era behaviour still works while the Viewer takes over.
  const onSelect = useCallback((v) => {
    setSelected(v)
    if (v) setViewerPush({ kind: 'node', node: v })
  }, [])

  /** Search over the currently visible graph. Local, instant, no backend. */
  const runSearch = useCallback(
    (q) => {
      const term = q.trim().toLowerCase()
      if (!term) return
      const rows = graph.nodes
        .filter((n) => n.type === 'entity' && n.label.toLowerCase().includes(term))
        .slice(0, 100)
      setViewerPush({ kind: 'results', query: q.trim(), rows })
      setShowViewer(true)
    },
    [graph]
  )

  /** Result row → move the graph to that node, then show it in the Viewer. */
  const navigateTo = useCallback(
    (row) => {
      graphApiRef.current?.focus?.(row.id)
      setViewerPush({ kind: 'node', node: row })
    },
    []
  )

  const isCy = engine === 'cytoscape'
  const params = isCy ? cyParams : fgParams
  const setParams = isCy ? setCyParams : setFgParams
  const schema = isCy ? CY_SCHEMA : FG_SCHEMA
  const defaults = isCy ? CY_DEFAULTS : FG_DEFAULTS

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value }))

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
          className="ctl-select"
        >
          {PILLARS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="all">All pillars</option>
        </select>

        <label className="ctl-check">
          <input
            type="checkbox"
            checked={showMembership}
            onChange={(e) => setShowMembership(e.target.checked)}
          />
          Pillar links
        </label>
        <label className="ctl-check">
          <input
            type="checkbox"
            checked={showRelations}
            onChange={(e) => setShowRelations(e.target.checked)}
          />
          Relationships
        </label>

        <input
          className="ctl-search"
          type="search"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch(search)
          }}
        />

        <button
          className={`btn${showGenie ? ' primary' : ''}`}
          onClick={() => setShowGenie((v) => !v)}
          title="Toggle Genie panel"
        >
          Genie
        </button>
        <button
          className={`btn${showViewer ? ' primary' : ''}`}
          onClick={() => setShowViewer((v) => !v)}
          title="Toggle Viewer panel"
        >
          Viewer
        </button>

        {/* Engine toggle */}
        <div className="engine-toggle" role="group" aria-label="Graph engine">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={`engine-btn${engine === e.id ? ' active' : ''}`}
              onClick={() => setEngine(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>

        <button className="btn" onClick={() => setShowParams(true)}>
          Params
        </button>

        <span className="meta">
          {graph.nodes.filter((n) => n.type === 'entity').length} nodes ·{' '}
          {graph.links.length} edges
        </span>
      </div>

      <div className={`graph-stage${showGenie ? ' with-genie' : ''}${showViewer ? ' with-viewer' : ''}`}>
        {showGenie && <GeniePanel open onToggle={() => setShowGenie(false)} />}

        <div className="graph-center">
          {isCy ? (
            <CytoscapeGraph
              graph={graph}
              params={cyParams}
              onSelect={onSelect}
              apiRef={graphApiRef}
            />
          ) : (
            <Suspense fallback={<div className="graph-loading">Loading force graph…</div>}>
              <ForceGraphView
                graph={graph}
                params={fgParams}
                onSelect={onSelect}
                apiRef={graphApiRef}
              />
            </Suspense>
          )}
        </div>

        {showViewer && (
          <Viewer
            push={viewerPush}
            onNavigate={navigateTo}
            currentDate={currentDate}
            onClose={() => setShowViewer(false)}
          />
        )}
      </div>

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

      {showParams && (
        <ParamModal
          title={`${isCy ? 'Cytoscape (fcose)' : 'Force Graph (d3)'} parameters`}
          schema={schema}
          values={params}
          defaults={defaults}
          onChange={setParam}
          onReset={() => setParams(defaults)}
          onClose={() => setShowParams(false)}
        />
      )}
    </div>
  )
}
