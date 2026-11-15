import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
// force-graph depends on d3-force-3d (not d3-force); its forceX/forceY are the
// ones that plug into this simulation.
import { forceX, forceY } from 'd3-force-3d'

/**
 * force-graph renderer (vasturiano). WebGL-free canvas 2D, d3-force physics.
 *
 * Labels: force-graph CAN draw per-node text — `nodeLabel` is only a hover
 * tooltip, but `nodeCanvasObject` gives you the raw canvas context, so we paint
 * the circle and the text ourselves. That is what makes label modes possible.
 */
export default function ForceGraphView({ graph, params, onSelect, apiRef }) {
  const fgRef = useRef(null)
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [hovered, setHovered] = useState(null)
  // Node reached via a search result — painted with a bright halo so it is
  // findable at fit zoom, where a 7px disc is otherwise invisible.
  const [focusId, setFocusId] = useState(null)

  // Viewport sizing — the canvas needs explicit pixel dims, not 100%.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // force-graph mutates the arrays it is given (it replaces source/target with
  // node refs and writes x/y onto nodes), so hand it a deep copy or the shared
  // model is corrupted for the other renderer.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    }),
    [graph]
  )

  // Physics. d3-force's default charge is weak for this node count, and the
  // centre force is what stops the graph drifting off-canvas.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !data.nodes.length) return

    fg.d3Force('charge')?.strength(params.charge)
    fg.d3Force('link')?.distance(params.linkDistance)
    fg.d3Force('center')?.strength(params.gravity)

    // Axis gravity keeps the cluster centred without the hard pull of `center`.
    if (params.gravity > 0) {
      fg.d3Force('x', forceX(0).strength(params.gravity * 0.5))
      fg.d3Force('y', forceY(0).strength(params.gravity * 0.5))
    } else {
      fg.d3Force('x', null)
      fg.d3Force('y', null)
    }

    fg.d3ReheatSimulation()
  }, [data, params.charge, params.linkDistance, params.gravity])

  // force-graph stops painting once the simulation cools, so a label-only param
  // change would never reach the canvas. Force one repaint.
  useEffect(() => {
    fgRef.current?.refresh?.()
  }, [params.labelMode, params.labelSize, params.labelMinZoom, params.nodeScale, focusId])

  // Canvas ink follows the active theme. force-graph paints outside the DOM,
  // so CSS vars don't reach it — read them off the body each render.
  const canvasColors = useMemo(() => {
    const cs = getComputedStyle(document.body)
    return {
      text: cs.getPropertyValue('--canvas-text').trim() || '#e6edf7',
      muted: cs.getPropertyValue('--muted').trim() || '#8b98ad',
      halo: cs.getPropertyValue('--bg').trim() || '#0b0e14',
    }
  }, [])

  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const r = Math.max(1.5, (node.size / 2) * params.nodeScale)
      const isHovered = hovered && hovered.id === node.id

      // Focus halo — light-yellow ring plus a yellow glow, drawn UNDER the disc.
      // Radius is 1.5x the node (was 3x, which read as twice too large). The
      // glow is a radial gradient at double the selected-button blur.
      if (focusId && node.id === focusId) {
        const haloR = r * 1.5
        const glowR = haloR + 12
        const grad = ctx.createRadialGradient(node.x, node.y, haloR, node.x, node.y, glowR)
        grad.addColorStop(0, 'rgba(255, 224, 102, 0.55)')
        grad.addColorStop(1, 'rgba(255, 224, 102, 0)')
        ctx.beginPath()
        ctx.arc(node.x, node.y, glowR, 0, 2 * Math.PI)
        ctx.fillStyle = grad
        ctx.fill()

        ctx.beginPath()
        ctx.arc(node.x, node.y, haloR, 0, 2 * Math.PI)
        ctx.lineWidth = 1.25 / globalScale
        ctx.strokeStyle = '#ffe066'
        ctx.stroke()
      }

      // Hub nodes are translucent rings; entities are solid discs.
      if (node.type === 'hub') {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
        ctx.fillStyle = `${node.color}38`
        ctx.fill()
        ctx.lineWidth = 2 / globalScale
        ctx.strokeStyle = node.color
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
        ctx.fillStyle = node.color
        ctx.globalAlpha = 0.85
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.lineWidth = (isHovered ? 2 : 1) / globalScale
        ctx.strokeStyle = node.kindColor
        ctx.stroke()
      }

      // ONE label path, painted BELOW the node. Hover does not change position
      // or styling — it only bypasses the zoom gate so the label is readable
      // when the graph is zoomed out. The gate is what makes labels static.
      const showByMode =
        params.labelMode === 'all' ||
        (params.labelMode === 'hubs' && node.type === 'hub')
      const show = isHovered || (showByMode && globalScale >= params.labelMinZoom)
      if (!show) return

      const fontSize = params.labelSize / globalScale
      ctx.font = `${node.type === 'hub' ? 600 : 400} ${fontSize}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = node.type === 'hub' ? 'middle' : 'top'
      ctx.fillStyle = node.type === 'hub' ? canvasColors.text : canvasColors.muted

      const text = node.label
      const y = node.type === 'hub' ? node.y : node.y + r + 2 / globalScale

      // Halo behind the text so it stays legible over edges.
      ctx.lineWidth = 3 / globalScale
      ctx.strokeStyle = canvasColors.halo
      ctx.strokeText(text, node.x, y)
      ctx.fillText(text, node.x, y)
    },
    [hovered, focusId, params.nodeScale, params.labelMode, params.labelSize, params.labelMinZoom, canvasColors]
  )

  // Hit area must match the painted radius, or clicks miss small nodes.
  const paintPointerArea = useCallback(
    (node, color, ctx) => {
      const r = Math.max(2, (node.size / 2) * params.nodeScale + 2)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.fill()
    },
    [params.nodeScale]
  )

  // Expose focus() so search results can fly the camera to a node.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      focus(id) {
        const fg = fgRef.current
        const n = data.nodes.find((x) => x.id === id)
        if (!fg || !n || n.x == null) return
        // `cameraPosition` is 3D-only — the 2D build has no such method, so
        // centring is done by panning to the node's graph coords, then zooming.
        const { width, height } = dimensions
        const zoom = Math.min(8, (fg.zoom() || 1) * 1.3)
        fg.centerAt(n.x, n.y, 700)
        fg.zoom(zoom, 700)
        // Keep the node centred after the zoom settles (zoom is about the
        // canvas centre, not the node).
        setTimeout(() => fg.centerAt(n.x, n.y, 0), 720)
        setFocusId(id)
      },
    }
  }, [data, apiRef, dimensions])

  const handleClick = useCallback(
    (node) => {
      if (!node) {
        setFocusId(null)
        return onSelect(null)
      }
      // A direct graph click must halo the node too — Cytoscape does this via
      // `node:selected`, but force-graph paints imperatively, so the selection
      // has to be mirrored into state.
      setFocusId(node.id)
      onSelect(node.type === 'hub' ? { hub: true, ...node } : { hub: false, ...node })
    },
    [onSelect]
  )

  return (
    <div ref={containerRef} className="graph-canvas">
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeLabel={(n) => n.label}
        linkColor={(l) => l.color}
        linkWidth={1}
        linkOpacity={0.55}
        linkLineDash={(l) => (l.line === 'dashed' ? [4, 3] : l.line === 'dotted' ? [1, 3] : null)}
        onNodeClick={handleClick}
        onNodeHover={setHovered}
        onBackgroundClick={() => onSelect(null)}
        warmupTicks={params.warmupTicks}
        cooldownTicks={params.cooldownTicks}
        cooldownTime={Infinity}
        d3AlphaDecay={params.alphaDecay}
        d3VelocityDecay={params.velocityDecay}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
      />
    </div>
  )
}
