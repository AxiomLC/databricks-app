# Momentum Engine — Technical README

> Machine-readable reference: flows, contracts, schemas, commands.
> Offloaded detail: [`n8n/README.md`](./n8n/README.md) ·
> [`notebooks/README.md`](./notebooks/README.md) · [`ui/README.md`](./ui/README.md) ·
> [`schemas/README.md`](./schemas/README.md) · [`ingestion/README.md`](./ingestion/README.md)
> Human-facing: [`humanREADME.md`](./humanREADME.md) · Current state: [`HANDOVER.md`](./HANDOVER.md)

---

## 1. Architecture

```
LOCAL (all network egress)                DATABRICKS FREE EDITION
  n8n: Ingestion Master                     Volume /Volumes/momentum/momentum/landing  (Bronze, files)
    ├ 5 scored legs   (Daily 05:00)              ↓
    ├ OpenAlex         (Mon 09:00)           silver_nodes / silver_edges   (Delta, rows)
    └ USPTO            (Daily 05:00)             ↓
         │ JSONL                              gold_level / gold_volume
         ▼                                        ↓
  validate → Gate → upload ──────────►      Lakebase (pgvector) + AppKit UI
```

**Hard constraint:** Databricks Free Edition has **no outbound network**. All
fetching happens locally. Never put fetch logic in a notebook.

---

## 2. Layout

| Path | Contents |
|---|---|
| `n8n/` | workflow export + canvas reference |
| `notebooks/silver/` | `silver_nodes.py`, `silver_edges.py` |
| `notebooks/gold/` | `gold_momentum.py` |
| `schemas/` | `dump.sql` — canonical DDL |
| `ui/` | AppKit / React / Cytoscape |
| `ingestion/` | schema + extraction notes |
| `scripts/` | `egress_check.py`, `export_ui_data.py`, `uspto_extract.py` |
| `data/` | local staging (gitignored) |

---

## 3. Data contracts

### 3.1 Bronze envelope (n8n emits)

One JSON object per line (`data/<source>/raw/<pillar>-<date>.jsonl`):

```json
{
  "node_id":     "std.native ID, registry-qualified for packages (npm:minio, pypi:minio)",
  "kind":        "paper | model | repo | package | trademark",
  "name":        "canonical display name",
  "pillar":      "self-hosted-vs-saas | temporal-memory | retrieval-engines | data-persistence | stack-structure",
  "source":      "arxiv | huggingface | github | openalex | pypi | npm | uspto",
  "raw_attrs":   "source-specific passthrough (see below)",
  "ingested_at": "ISO 8601 UTC"
}
```

| source | `raw_attrs` keys |
|---|---|
| `arxiv` | `summary`, `published` |
| `huggingface` | `downloads` *(cumulative)*, `likes`, `lastModified`, `pipeline_tag` |
| `github` | `stars`, `forks`, `lang`, `updated`, `html_url` |
| `openalex` | `doi`, `cited_by_count`, `publication_year`, `authorships` |
| `pypi` | `last_day`, `last_week`, `last_month` |
| `npm` | `days`, `total_7d`, `last_day`, `zero_days`, `series[]` |
| `uspto` | trademark record from `uspto_extract.py` |

### 3.2 `momentum.momentum.silver_nodes`

| Field | Type | Notes |
|---|---|---|
| `node_id` | string | registry-qualified, deterministic — dedup key |
| `kind` | string | `paper \| model \| package \| repo \| company \| trademark` |
| `name` | string | normalized |
| `pillar` | string | one of 5 |
| `source` | string | upstream API |
| `raw_attrs` | map | source-specific |
| `observed_date` | date | **partition key** |

### 3.3 `momentum.momentum.silver_edges`

| Field | Type | Notes |
|---|---|---|
| `edge_id` | string | sha1(edge_type + endpoints) — idempotent |
| `edge_type` | string | see §3.4 |
| `src_node_key` / `src_node_id` | string | FK → `silver_nodes` |
| `dst_node_id` | string | real node **or** synthetic hub (`pillar:*`, `company:*`) |
| `weight` | double | reserved |
| `observed_date` | date | **partition key** |

### 3.4 Edge types

| Edge | Rule | Rows |
|---|---|---|
| `pillar_membership` | entity → `pillar:<id>` | 2,406 |
| `paper_citation` | OpenAlex `referenced_works[]` | 371 |
| `package_dependency` | PyPI `requires_dist` / npm `dependencies` | 13 |
| `repo_package` | registry repo URL → GitHub `node_id` | 5 |
| `trademark_company` | canonical owner normalization | 1 |
| `arxiv_openalex` | arXiv ↔ DOI `10.48550/arxiv.<id>` | 0 (no overlap) |
| `paper_model` | HF `cardData.arxiv` ↔ arXiv | ❌ deferred |

**`paper_model` is deferred** — the arXiv ID lives in the per-model card
(`GET /api/models/<org>/<name>`), not the list response. ~543 extra requests/run
for an estimated 10–20% hit rate. Cheaper path: detail-fetch only models above a
download threshold (~250 requests).

**Bipartite, not pairwise.** Pillar membership is one edge per `(entity, pillar)`.
Pairwise would be O(n²): 543 models → ~147k edges for identical information.

DDL: [`schemas/dump.sql`](./schemas/dump.sql).

---

## 4. Ingestion

Full node wiring, per-leg parse rules, USPTO two-call pattern, and the Gate/Slack
approval flow: **[`n8n/README.md`](./n8n/README.md)**.

Summary:

| Leg | Trigger | Enters Gate? |
|---|---|---|
| arXiv, HF, GitHub, PyPI, npm | Daily 05:00 | ✅ via `Merge Validations` |
| OpenAlex | Mon 09:00 | ✅ direct (skips Merge) |
| USPTO | Daily 05:00 | ❌ own `Databricks1` sink |
| **Gate / Route / Slack** | — | `ALLOW_PARTIAL = false` — any failure blocks the batch |

`Pillar Keywords` is the single source of truth for all 5 pillars and writes
`pillars.json`. Never edit `pillars.json` directly.

---

## 5. Databricks processing

All stages are **full rebuilds**, not incremental merges. Bronze is immutable, so
a re-run is always correct and independent of prior state.

| Stage | Notebook | Action |
|---|---|---|
| Bronze | — | raw JSONL at `/Volumes/momentum/momentum/landing/<source>/`, never edited |
| Silver | `silver_nodes.py` | read JSONL → type → dedup → `silver_nodes`, one row per `(node_id, pillar, observed_date)` |
| Silver | `silver_edges.py` | `silver_nodes` → `silver_edges` |
| Gold | `gold_momentum.py` | → `gold_level` (per-entity, long) + `gold_volume` (entity counts) |

**Run order:** Silver → Gold → Edges. Gold and Edges both read Silver.

Verified 2026-11-14: `silver_nodes` 2,432 · `silver_edges` 2,796 ·
`gold_level` ~3,900 · `gold_volume` 63.

### 5.1 Platform terms — where each belongs

| Term | What it is | Where |
|---|---|---|
| **Lakehouse** | Architecture: object storage + warehouse table semantics. Not a product. | Whole layer |
| **Delta Lake** | Table format. ACID, schema enforcement, time travel via `_delta_log`. | Silver, Gold |
| **Parquet** | Physical columnar files inside Delta. | Never accessed directly |
| **Volume** | Permissioned folder. Holds **files**, not rows. | Bronze |
| **Delta table** | Files + log, queryable by name. Holds **rows**. | Silver, Gold |

**Volume vs table is the key distinction.** Bronze is read by path; Silver/Gold by
name. A Volume cannot be `SELECT`ed; a table cannot be `fs ls`'d.

**Not an RDBMS.** `PARTITIONED BY` is a directory layout, not an index —
partitioning on a millisecond timestamp produced 123 partitions for 1,849 rows.
Both Silver and Gold partition on `observed_date`.

**Implication:** Databricks is archive + compute, not a serving database. The UI
must not query Delta on page load. Lakebase is the serving copy.

### 5.2 Known data quirks

| Quirk | Detail |
|---|---|
| npm `series` exploded | 7 days of per-day downloads → `downloads_day` rows dated by **series day**. Gives npm history back to 2026-11-08. Final day dropped (npm returns 0 while in progress). |
| Double-count across pillars | An entity matching 4 pillars appears 4× with the same metric. Chart one pillar at a time; use `gold_volume.node_count` for distinct totals. |
| Pre-fix bare IDs in Bronze | Files before 2026-11-14 carry bare names. **Silver re-applies `npm:`/`pypi:` on read.** Prints the count — zero is normal, a jump means n8n regressed. |
| HF `downloads` is cumulative | Lifetime total. Never sum with `downloads_day`. |
| Growth columns absent | `growth_7d` needs a full window; computable from ~2026-11-18. |

---

## 6. UI

Detail: **[`ui/README.md`](./ui/README.md)**.

Stack: React + **Cytoscape.js** (`cytoscape-fcose`) and `force-graph`. Port `5180`,
`strictPort: true`. Reads a snapshot from `scripts/export_ui_data.py`.

| Screen | Reads |
|---|---|
| Momentum Board | `gold_level` + `gold_volume` |
| Graph Explorer | `silver_nodes` + `silver_edges` |
| Ask + Lineage | Genie (iframe; answers via Conversation API) |
| Setup / Pillars | `pillars.json` |
| Logs | n8n executions |

**Graph Explorer value is in four things:** pillar clusters (which pillars *share*
entities), momentum-as-colour + level-as-size, the time scrubber, and edge type as
line style. 2D is primary — the dataset is small, readability is the constraint,
not performance.

Screenshot harness: `ui/.shot.mjs` — how an agent sees the UI.

---

## 7. Configuration

Real values in `.env` (gitignored); `.env.example` is the template.

| Item | Value |
|---|---|
| Workspace | `dbc-0a49a6d2-f0ff.cloud.databricks.com` (AWS, Free Edition) |
| SQL warehouse | `557a444c183dfce2` (serverless, 2X-Small) |
| Catalog / schema | `momentum` / `momentum` |
| Volume | `/Volumes/momentum/momentum/landing` |
| Auth | PAT (`DATABRICKS_TOKEN`) |

**Lakebase:** `ep-noisy-thunder-d8g8zcz2.database.us-east-2.cloud.databricks.com:5432`,
db `databricks_postgres`, role `Admin` (native password, not OAuth), pgvector 0.8.0.
Password auth is off by default — enable at project **and** per-compute. Roles live
on the **branch**. Names are case-sensitive (`"Admin"`).

```sql
GRANT USAGE, CREATE ON SCHEMA public TO "Admin";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "Admin";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "Admin";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "Admin";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "Admin";
```

**Source keys:** USPTO ODP wired (`httpHeaderAuth` `CLHwnbf3V3UIf1N4`, header
`X-API-Key`). GitHub bearer, OpenAlex key, HF token all optional.

---

## 8. Commands

```bash
# UI
cd ui && npm run dev                      # http://localhost:5180 (port pinned)
python scripts/export_ui_data.py          # refresh snapshot after a pipeline run

# checks
python scripts/egress_check.py            # verify local network egress
python -c "import json,io; json.load(io.open('n8n/ingestion-master.json',encoding='utf-8'))"

# Databricks
winget install Databricks.DatabricksCLI
databricks auth login --host https://dbc-0a49a6d2-f0ff.cloud.databricks.com
databricks fs ls dbfs:/Volumes/momentum/momentum/landing
MSYS_NO_PATHCONV=1 databricks api ...     # required in Git Bash, or /api/ becomes a path
```

---

## 9. Debugging

### n8n

- **No execute endpoint.** The public API cannot run a workflow. Only webhook /
  form / chat nodes are programmatic triggers.
- **Draft vs published.** Executions run the *published* version; the editor loads
  the *draft*. Publish after MCP edits, or the editor shows stale content.
- **Inspect cheaply.** `mode: preview` or `filtered` + `nodeNames`.
  `itemsLimit: 0` gives structure without payloads. `full` returns megabytes of
  binary (arXiv XML, OpenAlex JSON, USPTO zips).
- **`$now` is not Luxon in Code nodes.** `$now.format()` throws. Use
  `new Date().toISOString().slice(0,10)`. `$now` works in *expressions* only.
- **Partial-update ops:** `updateNode` (needs `updates`), `patchNodeField`
  (`fieldPath` + `patches[]`), `addNode`, `addConnection`, `removeConnection`.
  There is no `updateNodeParameters` / `renameNode`.
- **Every node needs a connection** or the save fails. Park unused nodes on a
  NoOp with `disabled: true`.
- **Rate limits.** PyPI 429s on parallel requests — `batching.batch = {batchSize: 1,
  batchInterval: 1500}` + `retryOnFail`. npm needs 2500ms between scoped calls.
- **Node history:** `n8n_workflow_versions` (local snapshots) or `native`.

Everything else (Merge hangs, `WriteBinaryFile` overwrite, `cmd.exe` quoting,
scoped npm names): [`n8n/README.md`](./n8n/README.md) §Gotchas.

### Databricks

- **Three-part names required.** `momentum.momentum.silver_nodes`. Two parts resolve
  to a schema that does not exist.
- **`unionByName` is unsupported on serverless** (Spark Connect) — build one SQL
  string.
- **`WITH` is not allowed inside a `UNION ALL` branch** — wrap each in a subquery.
- **Free tier has no outbound network** — all fetching stays in n8n.
- **Zero matches is not an error.** `uspto_extract.py` exits 0 on a quiet day
  (`--strict` restores exit 2); `Validate USPTO` uploads nothing.
- **USPTO file bytes:** 6 downloads per file per 7 days, every request counts
  including 429s. Never re-run the USPTO leg twice in one day.
- **USPTO terms come from the `uspto` array**, not `keyword` — trademark prose shares
  no vocabulary with research. Research terms matched 0 of 7,430 filings.

### Data check

```sql
SELECT source, observed_date, count(*)
FROM momentum.momentum.silver_nodes
GROUP BY source, observed_date
ORDER BY observed_date DESC, source;
```

A source that stops appearing, or drops to zero, means that leg broke.

---

## 10. Known issues

| Issue | Impact |
|---|---|
| Approval flow only tested with a forced payload | A genuine leg failure may not reach Slack |
| `Write Error to UI` | Disabled placeholder, no URL — the HITL feed target |
| `Webhook · temp-debug` | Live, unauthenticated, wired to `Pillar Keywords` — a `GET` starts a full ingest |
| Test nodes on canvas | `Test` / `Test Error Payload` — remove after sign-off |
| OpenAlex bypasses Merge | `Gate.totalFiles` reads 6 daily / 1 weekly |

---

## 11. Environment

- `.env` is blocked from agent file tools (Zed `private_files`).
- Databricks CLI needs `MSYS_NO_PATHCONV=1` for `databricks api` calls.
- Shell is MSYS-Git Bash — `$VAR` and `%VAR%` are stripped; embed literal values.
