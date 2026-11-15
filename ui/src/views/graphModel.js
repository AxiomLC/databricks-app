import { PILLARS, PILLAR_COLORS, KIND_COLORS, momentumAt } from '../data.js'

/**
 * Neutral graph model. Both renderers (Cytoscape, force-graph) consume this
 * shape, so data shaping lives in one place and swapping engines is a render
 * concern only.
 *
 *   node: { id, label, type: 'hub'|'entity', color, kindColor, size, ... }
 *   link: { id, source, target, type, color, line }
 */

export const EDGE_STYLE = {
  pillar_membership: { line: 'solid', color: '#2b3648' },
  paper_citation: { line: 'solid', color: '#3b82f6' },
  package_dependency: { line: 'dashed', color: '#f59e0b' },
  repo_package: { line: 'dotted', color: '#10b981' },
  trademark_company: { line: 'dotted', color: '#ef4444' },
  arxiv_openalex: { line: 'solid', color: '#a855f7' },
}

/** Pillar hubs are synthetic — they are not rows in silver_nodes. */
export function pillarHubId(pillar) {
  return `pillar:${pillar}`
}

const MAX_WORDS = 6
const MAX_CHARS = 20

/**
 * Node labels are capped at 6 words and 20 characters. The char cap is applied
 * to the word-capped string, so a single long token (a package name, a DOI-ish
 * id) still cannot overflow the wrap width.
 */
export function truncateLabel(raw) {
  if (!raw) return ''
  const words = String(raw).trim().split(/\s+/)
  let out = words.slice(0, MAX_WORDS).join(' ')
  const wasWordCapped = words.length > MAX_WORDS
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS).trimEnd()
    return `${out}…`
  }
  return wasWordCapped ? `${out}…` : out
}

export function buildGraph({
  snapshot,
  currentDate,
  showMembership,
  showRelations,
  pillarFilter,
}) {
  const nodes = []
  const links = []

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
    nodes.push({
      id: pillarHubId(pillar),
      label: meta ? meta.label : pillar,
      type: 'hub',
      color: PILLAR_COLORS[pillar] || '#64748b',
      kindColor: PILLAR_COLORS[pillar] || '#64748b',
      size: 26 + Math.sqrt(count) * 3,
      count,
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

    nodes.push({
      id: n.id,
      // `label` is the canvas label — truncated at 6 words / 20 chars so it
      // cannot blow out the wrap width. `fullLabel` is the untruncated name for
      // surfaces with room to wrap (the Viewer).
      label: truncateLabel(n.label),
      fullLabel: n.label,
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
    })
  }

  const hubIds = new Set(nodes.filter((n) => n.type === 'hub').map((n) => n.id))

  for (const e of snapshot.edges) {
    const isMembership = e.type === 'pillar_membership'
    if (isMembership && !showMembership) continue
    if (!isMembership && !showRelations) continue

    const src = e.source
    const dst = e.target
    if (!visibleIds.has(src)) continue
    // Membership targets are hubs; other targets must be visible entities.
    if (isMembership) {
      if (!hubIds.has(dst)) continue
    } else if (!visibleIds.has(dst)) {
      continue
    }

    const style = EDGE_STYLE[e.type] || { line: 'solid', color: '#334155' }
    links.push({
      id: e.id,
      source: src,
      target: dst,
      type: e.type,
      color: style.color,
      line: style.line,
    })
  }

  return { nodes, links }
}

/* ---------- engine parameter schemas ---------- */

export const CY_DEFAULTS = {
  nodeRepulsion: 20000,
  idealEdgeLength: 60,
  gravity: 0.2,
  nodeSeparation: 75,
  numIter: 2500,
  // Zoom applied after the layout fits the graph. `fit` shrinks until every
  // node is visible, which at ~180 nodes puts neighbours closer than a node's
  // diameter, so the view is pulled in by this factor afterwards.
  zoomDistance: 1.8,
}

export const CY_SCHEMA = [
  {
    key: 'nodeRepulsion',
    label: 'Node repulsion',
    min: 1000,
    max: 120000,
    step: 1000,
    hint: 'Higher pushes nodes apart harder',
  },
  { key: 'idealEdgeLength', label: 'Edge length', min: 10, max: 300, step: 5 },
  {
    key: 'gravity',
    label: 'Gravity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Pulls the graph toward the centre',
  },
  {
    key: 'nodeSeparation',
    label: 'Component separation',
    min: 10,
    max: 300,
    step: 5,
    hint: 'Only applies between disconnected components',
  },
  { key: 'numIter', label: 'Iterations', min: 500, max: 8000, step: 100 },
  {
    key: 'zoomDistance',
    label: 'Zoom distance',
    min: 0.5,
    max: 4,
    step: 0.1,
    hint: 'How far the view pulls in after the layout fits',
  },
]

export const FG_DEFAULTS = {
  charge: -220,
  linkDistance: 45,
  gravity: 0.08,
  velocityDecay: 0.35,
  alphaDecay: 0.0228,
  cooldownTicks: 300,
  warmupTicks: 60,
  nodeScale: 1.6,
  // 'all' so static labels actually exist for entities; the zoom gate decides
  // when they appear, not the mode.
  labelMode: 'all',
  labelSize: 10,
  // The fit zoom for ~180 nodes lands well under 1.0, so a higher floor hides
  // every label on first paint and looks like labels are broken.
  labelMinZoom: 0.35,
}

export const FG_SCHEMA = [
  {
    key: 'charge',
    label: 'Charge (repulsion)',
    min: -1000,
    max: -10,
    step: 10,
    hint: 'More negative = stronger repulsion',
  },
  { key: 'linkDistance', label: 'Link distance', min: 5, max: 200, step: 5 },
  {
    key: 'gravity',
    label: 'Gravity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Centre force strength',
  },
  {
    key: 'velocityDecay',
    label: 'Velocity decay',
    min: 0.05,
    max: 0.95,
    step: 0.05,
    hint: 'Higher settles faster, less wobble',
  },
  {
    key: 'alphaDecay',
    label: 'Alpha decay',
    min: 0.005,
    max: 0.1,
    step: 0.001,
    hint: 'Higher cools the simulation sooner',
  },
  { key: 'cooldownTicks', label: 'Cooldown ticks', min: 50, max: 1000, step: 50 },
  {
    key: 'warmupTicks',
    label: 'Warmup ticks',
    min: 0,
    max: 300,
    step: 10,
    hint: 'Pre-settle before first paint',
  },
  { key: 'nodeScale', label: 'Node size ×', min: 0.5, max: 4, step: 0.1 },
  {
    key: 'labelMode',
    label: 'Labels',
    type: 'select',
    options: [
      { value: 'none', label: 'None (hover only)' },
      { value: 'hubs', label: 'Pillar hubs only' },
      { value: 'all', label: 'All nodes' },
    ],
  },
  { key: 'labelSize', label: 'Label size', min: 6, max: 24, step: 1 },
  {
    key: 'labelMinZoom',
    label: 'Label min zoom',
    min: 0.2,
    max: 3,
    step: 0.1,
    hint: 'Labels hide below this zoom level',
  },
]
