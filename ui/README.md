# Momentum Engine — UI

React + Vite frontend. Four views over the Gold/Silver tables.

## Run

```bash
npm install
npm run dev        # http://localhost:5180
```

The port is pinned in `vite.config.js` with `strictPort: true`, so it fails
loudly rather than drifting to another port.

## Data

The UI reads `public/data/snapshot.json`, generated from Databricks:

```bash
python ../scripts/export_ui_data.py
```

That file is gitignored — it is a build artifact, not source. Re-run it after
each pipeline run to refresh.

**Production** should query the SQL warehouse directly instead of reading a
snapshot. The shape in `src/data.js` is the contract either way.

## Views

| View | Reads | Notes |
|---|---|---|
| **Momentum Board** | `gold_level`, `gold_volume` | Pillar cards with median 7-day momentum, sparklines, top-movers table |
| **Graph Explorer** | `silver_nodes`, `silver_edges` | Cytoscape.js 2D. Date slider, pillar filter, edge-type toggles |
| **Setup / Pillars** | `silver_nodes` | Read-only — editing needs an n8n write endpoint |
| **Logs** | `gold_volume` | Entities per source per day. Full execution history lives in n8n |

## Graph Explorer notes

**2D, not 3D.** Most 3D graph views look impressive and answer nothing. The
dataset is small enough that readability, not performance, is the constraint.

**Colour = momentum, size = scale.** Green rising, red falling, grey no history.

**One pillar at a time by default.** All 1,015 nodes at once is an unreadable
blob; the pillar selector is the primary filter.

**Node size is capped at 14px.** This is load-bearing, not cosmetic. At ~180
nodes the layout cannot guarantee spacing greater than a large node's diameter,
so oversized nodes overlap and steal each other's clicks. If you raise the cap,
expect mis-targeted clicks.

**`randomize: true` is required.** Elements are re-added on every date or filter
change, and freshly added nodes all start at (0,0). With `randomize: false` the
layout has no spread to work from and leaves nodes stacked on identical
coordinates.

**`nodeSeparation` only applies between disconnected components.** Spacing
*within* a component comes from `nodeRepulsion` and `idealEdgeLength`.

## Not wired

- Pillar editing (needs an n8n endpoint to write `pillars.json`)
- Per-leg ingest toggles and cron enable/disable (needs n8n node-state API)
- Validation failures / gate decisions in Logs (live in n8n, not Databricks)
- Genie Ask + Lineage (separate work)
