# HANDOVER — Current State & Next Steps

Short status for resuming work. Full technical detail: [`techREADME.md`](./techREADME.md).
Pillar rationale: [`archive/pillars_research_11_14_2026.md`](./archive/pillars_research_11_14_2026.md).
Plain-language guide: [`humanREADME.md`](./humanREADME.md).

## Where we are

**Phase: DONE WITH THE PIPELINE → MOVING THE UI ONTO DATABRICKS.**
Ingestion, Silver, Gold and Edges run and are verified. USPTO terms are calibrated.
The UI renders real data from a snapshot. The next piece of work is deploying it
as a **Databricks App** so it queries the warehouse live, and comparing that to the
local SPA.

**Repo:** `AxiomLC/databricks-app` (public, GitHub).

**Ingestion (n8n):** `databricks: Ingestion Master (All Legs)` (`GQs6702n6vwYjKVa`),
active, 53 nodes / 4 triggers.

### Flow

```
Cron 05:00 ─┬→ Pillar Keywords ─┬→ arXiv / GitHub / HF / PyPI / npm → Parse → Write → Validate ─┐
            │                   └→ Write Pillars (dangling → pillars.json)                        │
            │                                                                                    ├→ Merge → Gate → Route
            └→ USPTO TMs → Find Latest TDXF → File List → Pick Latest → Download → Extract ───────┘
                                                                    → Validate USPTO ─┬→ Databricks
                                                                                      └→ Slack (on error)
                                                                              ┌────────────┴────────────┐
                                                                      0 (clean)│                        │1 (blocked)
                                                                              ▼                        ▼
                                                                      Databricks              Slack · Approve Upload
                                                                      files/uploadFile                 │
                                                                                                       ▼
                                                                                                     If1
                                                                                     approved ──┬── declined
                                                                                                ▼
                                                                                       Expand Approved → Databricks
```

- **7 legs:** arXiv, HF, PyPI, GitHub, npm, OpenAlex, USPTO
- **USPTO bypasses Gate** — unscored discovery feed, uploads directly, errors to Slack
- **OpenAlex** runs weekly via `Read Pillars` → `Pillar Keywords2`
- `Gate` holds `ALLOW_PARTIAL = false` — any failing leg halts all uploads

### Databricks tables (verified 2026-11-14)

| Table | Rows | Built by |
|---|---|---|
| `momentum.momentum.silver_nodes` | 2,432 | `notebooks/silver/silver_nodes.py` |
| `momentum.momentum.silver_edges` | 2,796 | `notebooks/silver/silver_edges.py` |
| `momentum.momentum.gold_level` | ~3,900 | `notebooks/gold/gold_momentum.py` |
| `momentum.momentum.gold_volume` | 63 | `notebooks/gold/gold_momentum.py` |

All four are **full rebuilds** from the layer below, and all are idempotent.

**Run order matters:** Silver → Gold → Edges. Gold and Edges both read Silver.

### Edge types (5)

| Type | Count | Source |
|---|---|---|
| `pillar_membership` | 2,406 | Silver rows → `pillar:<id>` hubs |
| `paper_citation` | 371 | OpenAlex `referenced_works` |
| `package_dependency` | 13 | PyPI `requires_dist` / npm `dependencies` |
| `repo_package` | 5 | Registry repo URL → GitHub `node_id` |
| `trademark_company` | 1 | USPTO owner |

## The five pillars (locked 2026-11-14)

| # | Pillar | id |
|---|---|---|
| 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` |
| 2 | Temporal Memory & Context | `temporal-memory` |
| 3 | Retrieval Strategy | `retrieval-engines` |
| 4 | Where Durable State Lives | `data-persistence` |
| 5 | Open Format vs Integrated Platform | `stack-structure` |

Source of truth is the `Pillar Keywords` node — it writes `pillars.json` at runtime
(gitignored). **Never edit `pillars.json`.**

⚠️ **Retired pillar IDs still exist in old Bronze files.** `graph-db`, `ai-memory`,
`hybrid-ram`, `object-storage`, `lakehouse` were renamed on 2026-11-14. Silver maps
them on read (§3.2 of the notebook). Do not remove that mapping — Bronze is never
rewritten, so those files will always carry the old names.

## The UI today

The UI is built and renders real data from a snapshot. It has **not** been
reviewed by a human.

**Run it locally:**

```bash
cd ui
npm run dev          # http://localhost:5180  (port pinned, strictPort)
python scripts/export_ui_data.py    # refresh snapshot after each pipeline run
```

**Verified:** all four views render, graph click-testing passes, slider steps
through all 7 dates, toggles work. **Not verified:** whether it *looks* right or is
useful — that still needs eyes, and is the same question the Databricks App spike
below is meant to answer.

## What's next — deploy the UI as a Databricks App

**The pitch:** the lakehouse is already there, Silver is already there. Put the UI
on top of it and you have your own app on Databricks — no server to babysit, no
snapshot to re-export. **Use AppKit**; that is the whole point and not a decision
to relitigate.

### Separate repo

This is a **new project in its own directory and its own GitHub repo**. It shares
nothing with `databricks-app` — different build, different deploy target,
different lifecycle. The only thing copied across is the SQL (see below).
Nothing in this repo imports from it or vice versa.

### Why not just host the static build

Databricks Apps will serve a Vite `dist/`, but a static build cannot query the
warehouse: browser-side calls to the SQL Statement API need a token and shipping
one to the client is a hard no. A small **backend** holds the credential and
proxies queries. **AppKit gives you that backend, the Express server, static file
serving and Vite dev mode already wired.**

### Free Edition limits — confirmed

From the Databricks Free Edition limitations page:

- **Up to 3 Databricks Apps per account.**
- **Apps run for up to 24 hours** after being started, updated or redeployed, then
  stop automatically. Restartable at any time.
- **One SQL warehouse, capped at `2X-Small`.** That is the warehouse the app must use.

So there is no compute problem — only a **daily restart**. Expect to run
`databricks apps start <APP_NAME>` (or redeploy) when you want to look at it.

### The template: `appkit-analytics`

`databricks/app-templates` → **`appkit-analytics`**. React + TypeScript + Vite +
Tailwind + Express, with `client/`, `server/`, `shared/`, `config/queries/`,
plus `app.yaml` and `databricks.yml` written for us.

Its two plugins are exactly our needs:

| Plugin | Gives us |
|---|---|
| Analytics | SQL execution against the SQL warehouse |
| Server | Express + static file serving + Vite dev mode |

`appkit-all-in-one` adds a **Genie plugin**, if we want the Genie panel done
properly rather than via iframe.

**`app.yaml`** — warehouse id comes from the resource, never hardcoded:

```yaml
command: ['npm', 'run', 'start']
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
```

**`databricks.yml`** — bundle, with the warehouse granted to the app:

```yaml
bundle:
  name: momentum-app

variables:
  sql_warehouse_id:
    description: SQL Warehouse ID

resources:
  apps:
    app:
      name: "momentum-app"
      source_code_path: ./
      lifecycle:
        started: true
      resources:
        - name: sql-warehouse
          sql_warehouse:
            id: ${var.sql_warehouse_id}
            permission: CAN_USE

targets:
  default:
    default: true
    workspace:
      host: https://<workspace>.cloud.databricks.com
    variables:
      sql_warehouse_id: <warehouse-id>
```

Deploy is a bundle deploy — do not hand-roll `databricks apps create`:

```bash
databricks auth login --host https://<workspace>.cloud.databricks.com
databricks bundle deploy
databricks apps start momentum-app      # or redeploy to restart the 24h clock
```

### Auth

Use the **service principal** — the app's own identity queries the warehouse. No
consent prompts, no per-user setup. Only switch to on-behalf-of
(`user_api_scopes: [sql]`) if per-user data governance is needed, which it is not
for a momentum dashboard.

### The SQL already exists

`scripts/export_ui_data.py` in this repo holds the exact six queries and its output
shape **is** the UI's contract (`ui/src/data.js` documents it: `nodes`, `edges`,
`volume`). Copy those queries into the new repo's `config/queries/` — copy, do not
import. The frontend then swaps `loadSnapshot()` for a request to the AppKit
analytics endpoint.

| Query | Table |
|---|---|
| nodes | `silver_nodes` (grouped) |
| edges | `silver_edges` |
| latest metrics | `gold_level` (row_number = 1) |
| momentum | `gold_level` (min_by / max_by) |
| volume | `gold_volume` |
| series | `gold_level` (filtered metrics) |

### What we are comparing

| | Local SPA (`npm run dev`) | Databricks App |
|---|---|---|
| Data | Snapshot, stale until re-exported | Live warehouse |
| Auth | None | Workspace login |
| Access | Only whoever runs the dev server | Anyone with workspace access |
| Genie | Cross-origin iframe, unreadable | Same-origin → answers reach the Viewer |
| Cost | Free | Free Edition: 3 apps, 24h then auto-stop |
| Iteration | Instant HMR | Redeploy per change |

The Genie row is the real prize: inside the app the backend can call the Genie
Conversation API, which finally makes the `genie` Viewer state producible
(§ *Genie — iframe now, API later*).

**Still not wired:** pillar editing, per-leg ingest toggles, cron toggle, validation
failures in Logs, Genie Conversation API.

## ⚠️ Untested: the error / approval flow

**Nobody has forced a failure through it.** `Route` output 1 → `Slack · Approve
Upload` → `If1` → `Expand Approved` → `Databricks` is wired and reads correctly,
but it has never actually fired. `Slack · Approve Upload` also still has a
placeholder channel name.

To test: make one leg fail deliberately (e.g. point `arXiv HTTP` at a bad URL, or
set `Gate`'s `ALLOW_PARTIAL` path), run the graph, and confirm the Slack message
arrives with working Approve/Decline buttons. Until then, treat error handling as
written-but-unproven — a real failure may silently go nowhere.

Do this **before** re-enabling the daily cron, so a genuine breakage on an
unattended 05:00 run does not pass unnoticed.

## UI reference

Detail you need when changing the UI. Not next-steps.

### Graph Explorer — two engines, two panels

**Engines.** Toolbar toggle between **Cytoscape** (fcose, one-shot layout) and
**Force Graph** (`react-force-graph-2d`, live d3 simulation). Both render the same
neutral model built in `views/graphModel.js`, so adding a third engine is one new
renderer file. Force Graph is `React.lazy`-loaded — a 206 kB chunk fetched only on
first toggle.

**Params modal** exposes each engine's own knobs (fcose: repulsion, edge length,
gravity, iterations; d3: charge, link distance, velocity decay, alpha decay,
cooldown). Schemas live in `graphModel.js`.

**Labels in force-graph work.** `nodeLabel` is only a hover tooltip; real text
comes from `nodeCanvasObject`. Modes: none / hubs only / all.

**Panels.** `Genie | graph | Viewer`, both side panels toggleable.

- **Viewer (right)** is a state timeline, not booleans — kinds `node`, `results`,
  `genie`. Dedupe, forward-truncate on push-after-Back, cap 50, Back never
  re-runs a query. `⛶` toggles 330px ↔ 46%.
- **Search bar** filters the *visible* graph by label substring — local, instant,
  no backend. It cannot see nodes hidden by the pillar filter or date slider.

### Genie — iframe now, API later

**Current state: iframe only.** The left panel renders a Genie Agent via
`<iframe>`. The embed `src` is pasted from the agent's **Share → Embed space**
dialog and stored in `localStorage` (⚙ button in the panel header).

**Two blockers, both real:**

1. **A workspace admin must allowlist the origin** — Settings → Security →
   External access → Embed dashboards. The allowlist is **empty by default**, so
   the frame renders blank no matter how correct the `src` is. This is the #1
   cause of "it doesn't work".
2. **The iframe is cross-origin, so its contents are unreadable.** Genie's answer
   cannot be lifted out of the frame into the Viewer. The `genie` Viewer state
   exists and renders, but **nothing produces it yet**.

**To pipe answers into the Viewer you need the Genie Conversation API**
(stateful, returns generated SQL + results). That requires a backend to hold
credentials — **which the Databricks App spike above now provides.** This is the
strongest reason to do the app, beyond live data: inside the app the backend can
call Genie and populate the `genie` Viewer state that today renders from nothing.

**Untested:** whether Genie can generate correct **recursive CTEs** for multi-hop
traversal over `silver_edges`. SQL traversal itself is fine (Databricks supports
`WITH RECURSIVE`, `MAX RECURSION LEVEL` default 100, 1M row cap) and 2,796 edges
is trivially small. The open question is NL→SQL reliability on recursion, not
capability. Test with three prompts: an aggregate over Gold, a one-hop edge
query, and a path trace.

**Also worth knowing:** the graph reads **Silver** (`silver_nodes` +
`silver_edges`), not Gold. Gold feeds the Momentum Board charts. Genie pointed at
Gold answers momentum questions; pointed at Silver it answers entity/edge
questions. Different tabs, different tables.

## ⚠️ Daily reminder — ingest on a new day

**The pipeline only accumulates history if it runs.** Momentum is a *change over
time*; a missed day is a hole in every chart.

- **Cron is currently disabled** (`Cron · Daily 05:00` is `disabled: true`).
  `TEMP CRON` is enabled instead and fires every 27 days — **not daily**.
- So on a new day, either re-enable the daily cron or trigger a run manually.
- After a run: `python scripts/export_ui_data.py` to refresh the UI snapshot.

**Check the data is actually arriving:**

```sql
SELECT source, observed_date, count(*)
FROM momentum.momentum.silver_nodes
GROUP BY source, observed_date
ORDER BY observed_date DESC, source;
```

A source that stops appearing, or drops to zero, means that leg broke.

**npm has the deepest history** — its API returns 7 days of per-day downloads, so
npm momentum works from day one. Every other source only has history from the
first day Silver ran (2026-11-11).

## Cleanup owed

| Item | Action |
|---|---|
| **Test the error/approval flow** | Highest priority — see the section above. Do it before re-enabling the cron |
| **Re-enable the daily cron** | `Cron · Daily 05:00` is `disabled: true`; `TEMP CRON` is a deliberate, unconnected scaffold. Leave both as they are until testing is done |
| `Slack · Approve Upload` channel | `channelId` is the placeholder `ingestion-alerts` — set the real channel before testing the error flow |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `TEMP CRON` / `Webhook · temp-debug` / manual trigger | all three are **unconnected** — inert. Keep during testing, delete before going live, then `cleanStaleConnections` |
| `READ ME` sticky note | still lists old pillar ids and the 55 MB figure (it is ~7 MB since the docket shrank) |
| `Merge Validations` input indices | shuffled (0,1,2,3,4 out of order) — harmless, confusing |
| `ui/.shot.mjs` | screenshot harness — **keep**, documented in `techREADME.md` §7.4 |

## Gotchas

### Agent workflow

- **The agent does not start n8n runs.** Edits and save/publish are fine; execution
  is the user's call. `n8n_test_workflow` with `method: direct` runs the whole graph
  from whichever trigger it picks, not just the node you asked about — execution
  15785 fired a full unplanned 2026-11-16 ingest that way.

### n8n

- **Draft vs published.** Executions run the *published* version; the editor loads
  the *draft*. After MCP edits, **publish** or the editor shows stale content. An open
  editor tab can autosave stale state over your changes.
- **Databricks node needs binary data.** Every validator must attach the file as
  binary, not just report on it. Filenames come from the validator's `file` field.
- **Scoped npm names contain `@` and `/`.** Both `Write npm JSONL` and `Validate npm`
  must sanitize identically, or Databricks creates nested directories.
- **n8n's public API has no execute endpoint.** Webhook / form / chat nodes are the
  only programmatic triggers.
- **HTTP node splits JSON arrays** into one item per element. For top-level arrays
  (HF), set `responseFormat: text` and `JSON.parse` in the Code node.
- **`WriteBinaryFile` overwrites.** Date-stamped names give a new file per day.
- **`Merge` (append) waits for all inputs** — never route a leg on a different
  trigger through a shared Merge; the run hangs.
- **Nested double quotes break under `cmd.exe`** in Execute Command nodes, and the
  failure can exit 0. Keep paths unquoted.
- **`node_id` must be registry-qualified** for packages (`npm:minio` vs
  `pypi:minio`). Fixed 2026-11-14; Silver re-applies the prefix for old files.

### Databricks

- **Free tier has no outbound network** — all fetching stays in n8n.
- **Three-part table names required.** `momentum.momentum.silver_nodes` — catalog
  and schema are both `momentum`. Two-part names resolve to a schema that does not
  exist.
- **`unionByName` is unsupported on serverless** (Spark Connect). Build one SQL
  string instead.
- **A `WITH` clause is not allowed inside a `UNION ALL` branch.** Wrap each branch
  in a subquery.
- **`PARTITIONED BY` is a directory layout, not an index.** Partitioning on a
  millisecond timestamp produced 123 partitions for 1,849 rows. Both Silver and
  Gold partition on `observed_date`.
- **USPTO is two-tier:** discovery is free; file bytes are capped at **6 per file
  per 7 days**, and every request counts including 429s.
- **USPTO terms come from the `uspto` array, not `keyword`.** Trademark
  goods/services prose shares no vocabulary with research or registries:
  `approximate nearest neighbor` and `self-hosted AI` matched **0 of 7,430**
  filings, so the leg fell back to `keyword` and produced an empty docket. With
  the `uspto` arrays the same file yields ~850 filings. Literal phrases only;
  two words minimum unless the word is unambiguous here (`database`, `chatbot`).
  Detail: `techREADME.md` §5.6.1.
- **Zero matches is not an error.** `uspto_extract.py` exits 0 on a quiet day
  (`--strict` restores exit 2), and `Validate USPTO` uploads nothing when the
  JSONL has no rows. Execution 15773 failed on the 2026-11-14 Sunday file purely
  because the old script treated an empty result as a fatal exit 2.
- **USPTO zips exceed the 5 GiB upload cap** — the extracted JSONL is what uploads.
- Lakebase: password connections are off by default (project **and** per-compute);
  roles live on the **branch**; role names are case-sensitive (`"Admin"`).

### UI

- **Node size is capped at 14px and that is load-bearing.** At ~180 nodes the
  layout cannot guarantee spacing greater than a large node's diameter, so
  oversized nodes overlap and steal each other's clicks.
- **`randomize: true` is required** in the fcose layout. Elements are re-added on
  every filter change and fresh nodes all start at `(0,0)`.
- **`nodeSeparation` only applies between disconnected components.** Spacing within
  a component comes from `nodeRepulsion` and `idealEdgeLength`.
- **Port is pinned to 5180** with `strictPort: true`. `npm run dev -- --port 5180`
  does not work — npm swallows the flag.
- **Cytoscape `wheelSensitivity: 3.8`** — measured, not guessed. At the default
  1.0 a mouse notch only zooms 1.047×; force-graph does 1.181×. 3.8 brings them
  within 1%. Cytoscape logs a cosmetic warning about non-default values; parity
  is worth more than a clean console.
- **`force-graph` needs `d3-force-3d`**, not `d3-force`. Wrong import gives you
  forces that silently never attach.
- **force-graph stops painting when the simulation cools** — call
  `fgRef.current.refresh()` when paint-affecting params change, or label edits
  never reach the canvas.
- **The Genie iframe is cross-origin.** You cannot read its contents. Answers
  reach the Viewer only via the Conversation API.

### Environment

- `.env` is blocked from agent file tools by the Zed `private_files` setting.
- Databricks CLI needs `MSYS_NO_PATHCONV=1` for `databricks api` calls, or MSYS
  rewrites `/api/...` into a Windows path.
