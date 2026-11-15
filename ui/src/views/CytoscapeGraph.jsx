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
          // Cytoscape's selector grammar needs spaces around the operator and
          // does not accept `type` as a bare class — `node[type = "entity"]`.
          selector: 'node[type = "entity"]:active',
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
          cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 400 })
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
    const MIN_ZOOM = 0.55
    if (cy.zoom() < MIN_ZOOM) {
      cy.zoom(MIN_ZOOM)
      cy.center()
    }
  }, [graph, params])

  return <div ref={containerRef} className="graph-canvas" />
}
