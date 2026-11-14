# HANDOVER — Current State & Next Steps

Short status for resuming work. Full technical detail: [`techREADME.md`](./techREADME.md).
Pillar rationale: [`archive/pillars_research_11_14_2026.md`](./archive/pillars_research_11_14_2026.md).
Plain-language guide: [`humanREADME.md`](./humanREADME.md).

## Where we are

**Phase: PIPELINE COMPLETE → UI TEST/DEBUG.** Ingestion, Silver, Gold and Edges all
run and are verified. The UI renders real data. Next work is testing and debugging
the UI.

**Repo:** `AxiomLC/databricks-app` (public, GitHub).

**Ingestion (n8n):** `databricks: Ingestion Master (All Legs)` (`GQs6702n6vwYjKVa`),
active, 54 nodes / 4 triggers.

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

## What's next — UI test/debug

The UI is built and renders real data. It has **not** been reviewed by a human.

```bash
cd ui
npm run dev          # http://localhost:5180  (port pinned, strictPort)
```

Data comes from a snapshot, not a live query:

```bash
python scripts/export_ui_data.py    # re-run after each pipeline run
```

**Known state:** all four views render; graph click-testing passes; slider steps
through all 7 dates; toggles work. What is *not* verified is whether it looks
right or is useful — that needs eyes.

**Open UI questions:**

1. Is the four-tab shape right? (Momentum Board / Graph Explorer / Setup / Logs)
2. Should it query the warehouse live instead of reading a snapshot?
3. Is the graph static layout acceptable, or should it animate?
4. Setup and Logs are read-only placeholders — worth wiring, or cut?

**Not wired:** pillar editing, per-leg ingest toggles, cron toggle, validation
failures in Logs, Genie Ask + Lineage.

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
| `Webhook · temp-debug` | testing scaffold — remove when done, then `cleanStaleConnections` |
| `TEMP CRON` | enabled alongside the disabled daily cron — **fires every 27 days, not daily** |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `READ ME` sticky note | still lists old pillar ids and the 55 MB figure |
| `Merge Validations` input indices | shuffled (0,1,2,3,4 out of order) — harmless, confusing |

## Gotchas

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

### Environment

- `.env` is blocked from agent file tools by the Zed `private_files` setting.
- Databricks CLI needs `MSYS_NO_PATHCONV=1` for `databricks api` calls, or MSYS
  rewrites `/api/...` into a Windows path.
