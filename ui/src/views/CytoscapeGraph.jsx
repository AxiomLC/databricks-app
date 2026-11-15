import React, { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'

// fcose packs nodes far better than the built-in cose, which collapsed this
// graph into overlapping blobs at low zoom.
cytoscape.use(fcose)

export default function CytoscapeGraph({ graph, params, onSelect, apiRef }) {
  const containerRef = useRef(null)
  const cyRef = useRef(null)

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
            color: 'var(--canvas-text)',
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
            // 30% smaller than the previous 8px.
            'font-size': 5.6,
            'text-valign': 'bottom',
            'text-margin-y': 3,
            // Labels are ZOOM-GATED, not hover-only. Cytoscape skips text when
            // `font-size * zoom` falls below `min-zoomed-font-size`, so at fit
            // zoom the graph stays clean and labels appear as you zoom in.
            // 13 = 9 * 1.3, i.e. labels appear 30% later than before.
            'text-opacity': 1,
            'min-zoomed-font-size': 13,
            // Wrap at ~20 chars / 3 words, and cap the whole label at 6 words
            // (the truncation itself happens in graphModel.js).
            'text-wrap': 'wrap',
            'text-max-width': '80px',
          },
        },
        {
          // Cytoscape's selector grammar needs spaces around the operator and
          // does not accept `type` as a bare class — `node[type = "entity"]`.
          // Hover only thickens the border now; labels are handled by the zoom
          // gate above, so hovering does not pop text in and out.
          selector: 'node[type = "entity"]:active',
          style: { 'border-width': 2 },
        },
        {
          // Selected node: light-yellow ring + yellow glow. The old white 9px
          // ring with a 28% white overlay read as a white-out blob, so the ring
          // is halved and the emphasis moved into a real glow.
          // Cytoscape has no box-shadow; `shadow-*` is the equivalent. 12px blur
          // is double the 6px glow used on selected buttons elsewhere.
          selector: 'node:selected',
          style: {
            'border-width': 4.5,
            'border-color': '#ffe066',
            'border-opacity': 1,
            'shadow-blur': 12,
            'shadow-color': '#ffe066',
            'shadow-opacity': 0.9,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'z-index': 9999,
          },
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
          selector: 'edge[type = "pillar_membership"]',
          style: { opacity: 0.25, width: 0.8 },
        },
        {
          selector: 'edge:selected',
          style: { opacity: 1, width: 2 },
        },
      ],
      layout: { name: 'preset' },
      // Measured: at the default 1.0 a real mouse notch only zooms 1.047x, while
      // force-graph does 1.181x — Cytoscape's `isWheelNotch` path divides the
      // delta by `inaccurateScrollFactor`, throttling genuine notches. 3.8x
      // matches the two engines. Cytoscape warns about non-default values, but
      // the warning is cosmetic and the parity is worth more.
      wheelSensitivity: 3.8,
      minZoom: 0.08,
      maxZoom: 4,
    })

    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data()
      onSelect(d.type === 'hub' ? { hub: true, ...d } : { hub: false, ...d })
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) onSelect(null)
    })

    cyRef.current = cy

    // Expose a focus() so search results can move the graph. Selecting the node
    // also centres it, which is the whole point of clicking a result.
    if (apiRef) {
      apiRef.current = {
        focus(id) {
          const n = cy.getElementById(id)
          if (!n || n.empty()) return
          cy.elements().unselect()
          n.select()
          // 30% closer than wherever we already are, so the node fills more of
          // the viewport instead of just re-centring at the same scale.
          const target = Math.min(cy.maxZoom(), cy.zoom() * 1.3)
          cy.animate({ center: { eles: n }, zoom: target }, { duration: 400 })
        },
      }
    }

    return () => {
      cy.destroy()
      cyRef.current = null
    }
    // onSelect is stable from the parent; re-creating the instance on every
    // render would destroy zoom/pan state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render elements when the date, filters or params change.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().remove()
    cy.add(graph.nodes.map((n) => ({ data: n })))
    cy.add(graph.links.map((l) => ({ data: l })))

    // `randomize: true` is REQUIRED here. Elements are re-added on every date
    // or filter change, and freshly added nodes all start at (0,0) — with
    // randomize:false the layout has no spread to work from and leaves nodes
    // stacked on identical coordinates, so clicks hit the wrong one.
    cy.layout({
      name: 'fcose',
      animate: false,
      randomize: true,
      quality: 'default',
      nodeSeparation: params.nodeSeparation,
      idealEdgeLength: params.idealEdgeLength,
      nodeRepulsion: params.nodeRepulsion,
      gravity: params.gravity,
      numIter: params.numIter,
      fit: true,
      padding: 40,
    }).run()

    // Zoom floor. `fit` shrinks until the whole graph is visible, which at ~180
    // nodes puts neighbours closer than a node's own diameter — clicks then hit
    // whatever is drawn on top. Better to show part of the graph at a readable
    // scale and let the user pan than to show all of it unreadably.
    // `zoomDistance` is the user-facing knob for how far in to pull.
    const MIN_ZOOM = 0.55
    const target = Math.max(MIN_ZOOM, cy.zoom() * params.zoomDistance)
    if (target > cy.zoom()) {
      cy.zoom(target)
      cy.center()
    }
  }, [graph, params])

  return <div ref={containerRef} className="graph-canvas" />
}
