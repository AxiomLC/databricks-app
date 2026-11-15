# Momentum Engine — UI

React + Vite frontend. Four views over the Gold/Silver tables.

## Setup from a fresh clone

```bash
cd ui
npm install          # installs exact versions from package-lock.json
npm run dev          # http://localhost:5180
```

The port is pinned in `vite.config.js` with `strictPort: true`, so it fails
loudly rather than drifting to another port.

**`npm install` is required** — `node_modules/` is gitignored. `package.json` and
`package-lock.json` are committed, so the lockfile reproduces the exact
dependency tree.

**`npm run build` is not needed for development.** It only produces a deployable
`dist/` (also gitignored). Use `npm run dev` unless you are deploying.

## Data — the real gate

The UI reads `public/data/snapshot.json`, generated from Databricks:

```bash
python ../scripts/export_ui_data.py
```

That file is **gitignored** — it is a build artifact, not source. Re-run it after
each pipeline run to refresh.

So a fresh clone runs fine but shows *"Could not load the data snapshot"* until
that script has been run. The script needs Databricks credentials in `.env`
(`DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID`). Without
warehouse access there is no data — that, not npm, is the real prerequisite.

**Production** should query the SQL warehouse directly instead of reading a
snapshot. The shape in `src/data.js` is the contract either way.

## Views

| View | Reads | Notes |
|---|---|---|
| **Momentum Board** | `gold_level`, `gold_volume` | Pillar cards with median 7-day momentum, sparklines, top-movers table |
| **Graph Explorer** | `silver_nodes`, `silver_edges` | Two render engines, date slider, pillar filter, edge toggles, search, Genie + Viewer panels |
| **Setup / Pillars** | `silver_nodes` | Read-only — editing needs an n8n write endpoint |
| **Logs** | `gold_volume` | Entities per source per day. Full execution history lives in n8n |

## Theme

Dark by default; a symbol-only toggle sits at the right of the title bar
(persisted to `localStorage`).

| | Accent | Secondary | Button glow |
|---|---|---|---|
| Dark | dark green `#22c55e` | deep yellow `#d9a406` | medium grey |
| Light | neon blue `#00b4ff` | black (thin borders) | neon blue |

Selected buttons use an accent border + glow, never a solid fill.

## Graph Explorer

**Two engines, one model.** `views/graphModel.js` builds a neutral
`{ nodes, links }` model; `CytoscapeGraph.jsx` and `ForceGraphView.jsx` are pure
renderers over it. Adding a third engine means one new renderer file.

| Engine | Library | Physics |
|---|---|---|
| Cytoscape | `cytoscape` + `cytoscape-fcose` | fcose, one-shot deterministic layout |
| Force Graph | `react-force-graph-2d` | `d3-force-3d`, live simulation |

Force Graph is `React.lazy`-loaded — a ~206 kB chunk fetched only on first toggle.

**Params modal** exposes each engine's own knobs. Values persist to
`localStorage` (`momentum_cy_params`, `momentum_fg_params`) and survive reloads.

**Labels.** Cytoscape gates labels by zoom via `min-zoomed-font-size` (text is
skipped when `font-size × zoom` falls below the threshold), so the graph stays
clean at fit zoom and labels appear as you zoom in. Force-graph paints labels
imperatively in `nodeCanvasObject`.

**Node labels are truncated** at 6 words / 20 chars in the model (`label`), with
the untruncated name kept as `fullLabel` for the Viewer.

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

**Cytoscape `wheelSensitivity: 3.8`** — measured, not guessed. At the default
1.0 a mouse notch zooms only 1.047×; force-graph does 1.181×. 3.8 brings them
within 1%.

## Panels

`Genie | graph | Viewer`, both side panels toggleable from the toolbar.

**Viewer (right)** is a state timeline — kinds `node`, `results`, `genie`.
Consecutive duplicate node clicks dedupe, a push after Back truncates the
forward path, capped at 50. Back is pure state restore: it never re-runs a query
and never moves the graph. Selecting a search result calls `onNavigate`, which
asks the active renderer to `focus(id)`.

**Search** filters the *visible* graph by label substring — local, instant, no
backend. It cannot see nodes hidden by the pillar filter or date slider.

**Genie (left)** renders a Databricks Genie Agent as an `<iframe>`. The embed
`src` is pasted from the agent's **Share → Embed agent** dialog and stored in
`localStorage` (⚙ in the panel header). Two fixed widths, toggled from the head
bar.

Two constraints:

1. A workspace admin must allowlist the embedding origin (Settings → Security →
   External access → Embed dashboards). The allowlist is empty by default, so the
   frame renders blank until that is done.
2. The iframe is **cross-origin**, so its contents are unreadable. Genie's answer
   cannot be lifted into the Viewer. The `genie` Viewer state exists and renders,
   but nothing produces it yet — that needs the Genie Conversation API and a
   backend.

The Genie panel keeps light constants in **both** themes because the Databricks
iframe paints light with black text; a dark panel would make its output
unreadable.

## Not wired

- Pillar editing (needs an n8n endpoint to write `pillars.json`)
- Per-leg ingest toggles and cron enable/disable (needs n8n node-state API)
- Validation failures / gate decisions in Logs (live in n8n, not Databricks)
- Genie Conversation API (answers into the Viewer)
