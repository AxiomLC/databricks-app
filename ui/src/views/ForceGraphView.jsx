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
  }, [params.labelMode, params.labelSize, params.labelMinZoom, params.nodeScale])

  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const r = Math.max(1.5, (node.size / 2) * params.nodeScale)
      const isHovered = hovered && hovered.id === node.id

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

      // Label visibility: mode, zoom floor, and hover always wins.
      const showByMode =
        params.labelMode === 'all' ||
        (params.labelMode === 'hubs' && node.type === 'hub')
      const show = isHovered || (showByMode && globalScale >= params.labelMinZoom)
      if (!show) return

      const fontSize = params.labelSize / globalScale
      ctx.font = `${node.type === 'hub' ? 600 : 400} ${fontSize}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = node.type === 'hub' ? 'middle' : 'top'
      ctx.fillStyle = node.type === 'hub' ? '#e6edf7' : '#8b98ad'

      const text = node.label
      const y = node.type === 'hub' ? node.y : node.y + r + 2 / globalScale

      // Halo behind the text so it stays legible over edges.
      ctx.lineWidth = 3 / globalScale
      ctx.strokeStyle = 'rgba(11, 15, 22, 0.85)'
      ctx.strokeText(text, node.x, y)
      ctx.fillText(text, node.x, y)
    },
    [hovered, params.nodeScale, params.labelMode, params.labelSize, params.labelMinZoom]
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
        // Pull the camera back proportionally so the node is not clipped.
        const PULLBACK = 120
        const r = Math.max(Math.hypot(n.x, n.y), 1)
        const f = 1 + PULLBACK / r
        fg.cameraPosition({ x: n.x * f, y: n.y * f, z: 0 }, { x: n.x, y: n.y, z: 0 }, 700)
        fg.zoom(2, 700)
      },
    }
  }, [data, apiRef])

  const handleClick = useCallback(
    (node) => {
      if (!node) return onSelect(null)
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
