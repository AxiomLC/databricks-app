# Momentum Engine — Technical README

> **Machine/AI-readable reference.** Functions, parsing rules, node wiring, and
> data contracts. Human-facing explanation: [`humanREADME.md`](./humanREADME.md).
> Current state: [`HANDOVER.md`](./HANDOVER.md).
> Original build spec (archived): [`archive/build_readme Databricks.md`](./archive/build_readme%20Databricks.md)

---

## 1. Architecture

```
LOCAL MACHINE (all network egress)          DATABRICKS FREE EDITION
  n8n: Ingestion Master                      Volume  → Bronze (raw)
    ├ 5 daily legs  (05:00)                    ↓
    ├ OpenAlex      (Mon 09:00)              Silver  (MERGE, dedup, node/edge split)
    └ USPTO Hist    (1st 03:00)                ↓
        │ JSONL / zip                        Gold    (aggregates per pillar/source)
        ▼                                      ↓
    validate → gate → upload ──────────►     Lakebase (pgvector)  +  AppKit UI
```

**Hard constraint:** Databricks Free Edition has **no outbound network**. All
fetching happens locally. Never put fetch/scrape logic in a notebook.

---

## 2. Repository Layout

```
humanREADME.md         plain-language guide
techREADME.md          this file
HANDOVER.md            current state + next steps
archive/               superseded docs
notebooks/silver/      silver_nodes.py — MERGE & dedup
notebooks/gold/        gold_momentum.py — aggregates
schemas/               dump.sql — canonical DDL
n8n/                   workflow export
ui/                    AppKit (Node + React) scaffold
scripts/               egress_check.py, name normalization
data/                  local staging (gitignored)
```

---

## 3. Data Contracts

### 3.1 Bronze envelope (what n8n emits)

One JSON object per line. Every leg emits this exact shape.

```json
{
  "node_id":     "string  — stable identity, source-native ID",
  "kind":        "string  — paper | model | repo | package | trademark",
  "name":        "string  — canonical display name",
  "pillar":      "string  — graph-db | lakehouse | ai-memory | hybrid-ram | object-storage",
  "source":      "string  — arxiv | huggingface | github | openalex | pypi | uspto",
  "raw_attrs":   "object  — source-specific fields, passthrough",
  "ingested_at": "string  — ISO 8601 UTC"
}
```

`raw_attrs` per source:

| source | keys |
|---|---|
| `arxiv` | `summary`, `published` |
| `huggingface` | `downloads`, `likes`, `lastModified`, `pipeline_tag` |
| `github` | `stars`, `forks`, `lang`, `updated`, `html_url` |
| `openalex` | `doi`, `cited_by_count`, `publication_year`, `authorships` |
| `pypi` | `last_day`, `last_week`, `last_month` |
| `uspto` | *(none — binary zip, no JSONL)* |

### 3.2 Silver — nodes (`momentum.silver_nodes`)

| Field | Type | Notes |
|---|---|---|
| `node_id` | string | `node_id(kind, ...)` deterministic hash — MERGE key |
| `kind` | string | `paper` \| `model` \| `package` \| `repo` \| `company` \| `trademark` |
| `name` | string | canonical, normalized |
| `pillar` | string | one of 5 |
| `source` | string | upstream API |
| `raw_attrs` | map<string,string> | source-specific |
| `ingested_at` | timestamp | partition key |

### 3.3 Silver — edges (`momentum.silver_edges`)

| Field | Type | Notes |
|---|---|---|
| `edge_id` | string | MERGE key |
| `edge_type` | string | `paper_model` \| `paper_citation` \| `repo_package` \| `trademark_company` |
| `src_node_id` | string | FK → nodes.node_id |
| `dst_node_id` | string | FK → nodes.node_id |
| `weight` | double | citation count, download delta |
| `source` | string | upstream API |
| `ingested_at` | timestamp | partition key |

### 3.4 Join rules

| Edge | Rule |
|---|---|
| `paper_model` | HF `arxiv_id` ↔ arXiv ID |
| `paper_citation` | arXiv DOI ↔ OpenAlex work |
| `repo_package` | parse `setup.py` / `pyproject.toml` → PyPI name |
| `trademark_company` | `strip_company_artifacts` canonical normalization |

DDL: [`schemas/dump.sql`](./schemas/dump.sql).

---

## 4. Ingestion (n8n)

**Workflow:** `databricks: Ingestion Master (All Legs)` — ID `GQs6702n6vwYjKVa`, active.

### 4.1 Leg pattern

```
Schedule → Pillar Keywords → HTTP → Code(parse → JSONL binary) → WriteBinaryFile → Validate
```

All five daily legs converge: `Validate ×5 → Merge(append, 5 inputs) → Gate → Route`.

### 4.2 Pillar Keywords — single source of truth

Code node, 5 items. Only place to change queries.

```js
{ pillar: 'graph-db',       keyword: 'graph database', hf: 'graph',     pypi: ['neo4j','kuzu','falkordb','memgraph','gremlinpython'] },
{ pillar: 'lakehouse',      keyword: 'lakehouse',      hf: 'lakehouse', pypi: ['deltalake','pyiceberg','duckdb','lance'] },
{ pillar: 'ai-memory',      keyword: 'agent memory',   hf: 'memory',    pypi: ['letta','mem0ai','zep-python','langmem'] },
{ pillar: 'hybrid-ram',     keyword: 'vector index',   hf: 'vector',    pypi: ['faiss-cpu','usearch','hnswlib','annoy'] },
{ pillar: 'object-storage', keyword: 'object storage', hf: 'storage',   pypi: ['boto3','minio','pyarrow','obstore'] },
```

| Field | Consumed by | Constraint |
|---|---|---|
| `keyword` | arXiv `all:`, GitHub `q=`, OpenAlex `default.search:` | free text |
| `hf` | Hugging Face `search=` | **single word only** — HF ignores multi-word phrases |
| `pypi` | `Flatten PyPI Packages` → one item per package | array |

### 4.3 Triggers

| Node | Cron | Fans out to |
|---|---|---|
| `Cron · Daily 05:00` | `0 5 * * *` | arXiv, HF, GitHub, USPTO TM, Flatten PyPI |
| `OpenAlex WEEKLY Mon 09:00` | `0 9 * * 1` | `Pillar Keywords2` → OpenAlex |
| `USPTO MONTHLY Hist 1st 03:00` | `0 3 1 * *` | `Pillar Keywords1` → USPTO Historical |
| `TEMP CRON` | — | manual test trigger, **currently enabled** |

### 4.4 Parse rules per source

Every parse node loops `items` and emits **one output item per input item**;
otherwise the 5 pillar items collapse into one file. `pillar` is absent from
every HTTP response, so it is read positionally from `Pillar Keywords` (or
`Flatten PyPI Packages`).

| Leg | Response shape | Extraction |
|---|---|---|
| arXiv | Atom XML string | regex `<entry>…</entry>`, then `<id>`, `<title>`, `<summary>`, `<published>` |
| Hugging Face | top-level JSON array | `responseFormat: text` + `JSON.parse` — n8n otherwise splits the array into one item per model |
| GitHub | `{ items: [...] }` | `items[]` |
| OpenAlex | `{ results: [...] }` | `results[]` |
| PyPI | `{ data: {...} }` | `data`, one row per package |
| USPTO | `{ bulkDataProductBag: [...] }` | two calls — see §4.6 |

### 4.5 Output paths

| Leg | Path | Rows/pillar |
|---|---|---|
| arXiv | `data/arxiv/raw/<pillar>-<date>.jsonl` | 19 |
| Hugging Face | `data/huggingface/raw/<pillar>-<date>.jsonl` | 99 (lakehouse 19) |
| GitHub | `data/github/raw/<pillar>-<date>.jsonl` | 19 |
| OpenAlex | `data/openalex/raw/<pillar>-<date>.jsonl` | 49 |
| PyPI | `data/pypi/raw/<pillar>-<pkg>-<date>.jsonl` | 1 per package, 21 files |
| USPTO TM | `data/uspto/raw/tdxf-<file>.zip` | 1 zip, 55 MB |
| USPTO Hist | `data/uspto/raw/annual-<file>.zip` | 1 zip, 21 MB |

`WriteBinaryFile` **overwrites**. Filenames carry the date, so a new day makes a
new file, but a second run on the same day replaces that day's file. USPTO zips
have no date in the name and overwrite on every run.

### 4.6 USPTO ODP — two-call download

Search returns no download links.

```
1. GET /api/v1/datasets/products/search?q=trademark&rows=100
     → { count, bulkDataProductBag: [ { productIdentifier, productTitleText } ] }

2. GET /api/v1/datasets/products/{productIdentifier}
     → { bulkDataProductBag: [ { productFileBag: { fileDataBag: [
           { fileName, fileSize, fileDataFromDate, fileDownloadURI }
       ] } } ] }

3. GET {fileDownloadURI}   (same X-API-Key credential)
```

| Leg | `productIdentifier` | Description |
|---|---|---|
| Trademarks | `TRTDXFAP` | daily applications, 682 files |
| Historical | `TRTYRAP` | annual backfile to 1884, 177 parts (~10 GB) |

- `q=trademark` also matches patents (`GZLST`, CPC) — always pin by `productIdentifier`.
- Header casing is irrelevant (`X-API-Key` / `X-API-KEY` / `x-api-key` all 200).
- `TRTYRAP`: only the newest of 177 parts is fetched — a fragment, not the dataset.

---

## 5. Validation & Gate

### 5.1 Validate nodes (`Validate arXiv|HF|GitHub|OpenAlex|PyPI`)

Reads `binary.data`, splits on newlines, checks per line:

| Check | Failure message |
|---|---|
| file non-empty | `file is empty` |
| valid JSON | `line N: invalid JSON` |
| required fields present | `line N: missing <field>` |
| `kind` matches leg | `line N: kind=X expected Y` |
| `source` matches leg | `line N: source=X expected Y` |
| no duplicate `node_id` | `line N: duplicate node_id X` |

Never throws — bad data is data. Emits:

```js
{ leg, pillar, file, count, ok, errorCount, errors: [...max 20] }
```

`Validate USPTO` is different: it validates the **JSONL produced by the
extractor**, not the zip. It checks `exitCode`, that the file exists, that every
line parses, that `node_id`/`kind`/`name`/`source` are present, and that `pillar`
is one of the five. It also reports `pillarCounts` so the Gate summary shows the
split. Zero matches is **not** a failure — a quiet day is legitimate.

**Possible simplification (not implemented):** arXiv, HF, GitHub and PyPI
share an identical row shape, so they could collapse into one `Validate JSONL`
node reading `leg`/`kind` from the item (PyPI needs a one-line filename branch
for `pkg`). OpenAlex must keep its own validator — it is on a separate trigger,
and `Merge` (append) waits for all inputs, so routing it through the shared
node would hang the weekly run. USPTO cannot join: its rows come from a local
Python extractor, not from an HTTP response.

### 5.2 Gate

```js
const ALLOW_PARTIAL = false;   // ← the one switch
```

| `ALLOW_PARTIAL` | Any leg fails | Result |
|---|---|---|
| `false` (default) | yes | all uploads halted, one error item |
| `true` | yes | failing legs skipped, healthy legs upload, error item still emitted |

**Blocked path:** emits **one** item carrying the report plus every healthy
payload as a named binary (`f0`, `f1`, …) and a `manifest[]` of
`{ key, leg, file, pillar, rows }`. This is what makes approval work without
re-running the legs.

### 5.3 Route

Switch, expression mode, 2 outputs:

```js
{{ $json.route === 'upload' ? 0 : 1 }}
```

- **0** → `Databricks` (upload)
- **1** → `Slack · Approve Upload`

### 5.4 Approval branch

```
Slack · Approve Upload (sendAndWait, responseType: approval)
  → If1 ($json.data.approved === true)
      true  → Expand Approved → Databricks
      false → Write Error to UI (disabled placeholder)
```

`Slack · Approve Upload` blocks up to 12 h, then expires. `Expand Approved`
rebuilds one item per healthy leg from `$('Gate').first().binary` using the
`manifest`, so nothing is re-fetched.

### 5.5 Upload

`n8n-nodes-base.databricks`, `resource: files`, `operation: uploadFile`.

| Param | Value |
|---|---|
| `volumePath` | `momentum.momentum.landing` (three-part name, not `/Volumes/...`) |
| `filePath` | `={{ $json.leg }}/{{ $json.file }}` |
| `dataFieldName` | `data` |
| `overwrite` | `true` |
| credential | `databricksApi` → `Databricks account` (`a2rY0vios76vhi7S`) |

Cap: 5 GiB per file. Fine for JSONL, **not** for USPTO zips.

### 5.6 USPTO leg (two-tier cost model)

USPTO is the only leg that is not a keyword search. It is a **subscription**:
collect the day's bulk dump, then filter locally.

```
Cron ──► USPTO TMs ──► Find Latest TDXF ──► USPTO File List ──► Pick Latest File
         (executeOnce)   (pin TRTDXFAP)     (682 filenames)      (newest by
                                                                  fileDataToDate)
   ──► Download TDXF File ──► Write TDXF ──► Extract USPTO Gems ──► Validate USPTO
       (stopWorkflow)        (55 MB zip)     (python, 13 s)        (JSONL checks)
```

`USPTO TMs` hangs off the **crons**, not `Pillar Keywords` — bulk data has no
per-pillar dimension, so the payload is irrelevant. `executeOnce: true` keeps it
to one request.

**Cost asymmetry — the thing to remember:**

| Tier | Endpoint | Cost |
|---|---|---|
| Discovery | `/datasets/products/search`, `/datasets/products/{id}` | free |
| Bytes | `/datasets/products/files/{id}/{file}` | **6 per file per 7 days** |

Every request counts, **including 429s**. Exceeding it locks that URI for
604800 s. The key itself stays valid; other files and endpoints keep working.

Consequences baked into the wiring:

- `Download TDXF File` and `USPTO File List` are `onError: stopWorkflow` with
  `retryOnFail: false`. USPTO's FAQ explicitly asks for no automatic retries.
- Never re-run the workflow twice in one day — the second run hits the same
  filename and burns quota.
- Each new day is a new filename, so the daily cadence is naturally safe.

**Extraction** is `scripts/uspto_extract.py`, invoked by `Extract USPTO Gems`
(`n8n-nodes-base.executeCommand`, `executeOnce: true`):

```
python C:/Users/q1fre/ZED/databricks-app/scripts/uspto_extract.py \
  C:/Users/q1fre/ZED/databricks-app/data/uspto/raw/{{ $('Pick Latest File').item.json.file }}
```

No quotes around the path — nested double quotes break under `cmd.exe` and the
failure exits 0, which would look like success.

Why Python and not a Code node: the zip is 55 MB → **1.08 GB of XML**. A Code
node would hold that as a UTF-16 string (~2 GB) and die. The script streams with
`lxml.iterparse`, one `<case-file>` at a time, flat memory. Measured: 62,981
cases in **13.5 s**.

| Behaviour | Detail |
|---|---|
| Input | TDXF zip (default: newest in `data/uspto/raw/`) |
| Terms | read from `pillars.json` (written by `Write Pillars`) |
| Match | word-bounded, case-insensitive, plural-tolerant (`graph database` → `graph databases`) |
| Negation guard | skips a term inside an exclusion clause (`excluding`, `except`, `not including`, `disclaim…`) |
| Output | `<zip>.jsonl`, Bronze envelope, one record per hit |
| Pruning | deletes every other `.zip` in the raw dir after a successful run |
| Exit 0 | success |
| Exit 1 | bad input (missing zip / `pillars.json` / unreadable XML) |
| Exit 2 | no matches (writes empty JSONL, warns) |

Measured on `tdxf-apc261110.zip`: 62,981 cases → **5 matches** (ai-memory 3,
hybrid-ram 1, object-storage 1). Trademarks are ~0.008% relevant; the leg is
kept because the hits are high-signal (Elasticsearch B.V., FastS3 Inc.).

### 5.7 `pillars.json` — shared pillar definitions

`Pillar Keywords` (Code node) remains the single source of truth. A dangling
`Write Pillars` node (`n8n-nodes-fs.writeFile`) hangs off it and overwrites
`pillars.json` in the repo root each run. The Python extractor reads that file.

A Code node has no filesystem access, so it cannot read the JSON itself — the
write direction is the only way to share without duplicating the list.

`pillars.json` is gitignored (runtime artifact).

---

## 6. Databricks Processing

| Stage | Notebook | Action |
|---|---|---|
| Bronze | — | raw files from Volume, as-landed, partitioned by date/source |
| Silver | `notebooks/silver/silver_nodes.py` | deterministic `node_id` hash, canonical name normalization, `MERGE` into `silver_nodes` / `silver_edges` (idempotent, latest-wins) |
| Gold | `notebooks/gold/gold_momentum.py` | aggregate downloads/stars/citations by `(metric_date, pillar, source)` → `gold_momentum` |

---

## 7. UI (AppKit / React)

Scaffolded in `ui/`, not built. Port `8050`.

| Screen | Reads | Purpose |
|---|---|---|
| Momentum Board | `gold_momentum` | time-series per pillar per signal; divergence view |
| Graph Explorer | `silver_nodes` + `silver_edges` | 3D force-directed graph |
| Ask + Lineage | Genie | NL Q&A with lineage cards |

---

## 8. Configuration

Real values in `.env` (gitignored). `.env.example` is the committed template.

### Databricks

| Item | Value |
|---|---|
| Workspace | `dbc-0a49a6d2-f0ff.cloud.databricks.com` (AWS, Free Edition) |
| SQL warehouse | `557a444c183dfce2` (serverless, 2X-Small) |
| Catalog / schema | `momentum` / `momentum` |
| Volume | `/Volumes/momentum/momentum/landing` |
| Auth | PAT (`DATABRICKS_TOKEN`) |

### Lakebase

| Item | Value |
|---|---|
| Endpoint | `ep-noisy-thunder-d8g8zcz2.database.us-east-2.cloud.databricks.com:5432` |
| Database | `databricks_postgres` |
| Role | `Admin` — native password role (not OAuth) |
| pgvector | 0.8.0 |

**Auth notes:**
- Password connections are off by default — enable at project level *and* per
  compute endpoint.
- Roles live on the **branch**, not project Settings.
- Role names are case-sensitive: `"Admin"` needs double quotes.
- The SQL editor only accepts the OAuth identity — test password roles from psql.
- A UI-created password role owns nothing; grant explicitly:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO "Admin";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "Admin";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "Admin";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "Admin";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "Admin";
```

### Source API keys

| Credential | Status | Notes |
|---|---|---|
| USPTO ODP | **wired** | `httpHeaderAuth` `USPTO ODP` (`CLHwnbf3V3UIf1N4`), header `X-API-Key`, all 4 USPTO nodes |
| GitHub bearer | optional | 10/min → 5,000/hr |
| OpenAlex key | optional | shared free budget $0.10/day per IP → $1/day with key (`api_key=` param) |
| Hugging Face token | optional | public API works without it |

---

## 9. Testing

```bash
python scripts/egress_check.py     # verify local network egress
```

### Why a webhook is needed to fire the workflow

n8n's **public API has no execute endpoint** — it can create, read, update,
activate and deactivate workflows, but not run one. The only programmatic
trigger paths are webhook / form / chat nodes. A `Schedule Trigger` fires on
its cron or when a human clicks **Execute Workflow** in the UI; neither is
reachable over HTTP.

So for agent-driven testing: add a temporary `Webhook` node (GET, path
`temp-debug`) wired to `Pillar Keywords`, fire it, then remove it and run
`cleanStaleConnections`. This is a testing scaffold, not part of the design.

### n8n operational tricks

| Trick | Detail |
|---|---|
| **`$now` is not Luxon in Code nodes** | `$now.format('yyyy-MM-dd')` throws `is not a function`. Use `new Date().toISOString().slice(0, 10)`. `$now` works in *expressions* only. |
| **Inspect executions cheaply** | `mode: preview` or `filtered` with `nodeNames`. `full` returns megabytes of binary (arXiv XML, OpenAlex JSON, USPTO zips) and will blow up the response. |
| **`itemsLimit: 0`** | Returns structure without payloads — the only way to read a node's output shape when it carries binary. |
| **Partial-update op names** | `updateNode` (needs an `updates` object), `patchNodeField` (needs `fieldPath` + `patches[]`), `addNode`, `addConnection`, `removeConnection`. There is **no** `updateNodeParameters`, `renameNode`, or `setNodeSettings` — rename via `updates.name`, node settings via `updates.onError` / `retryOnFail`. |
| **Node IDs vs names** | Names containing `·` or spaces fail as connection targets. Use the node **id** for `addConnection` / `removeConnection` / `updateNode`. |
| **Every node needs a connection** | Saving fails with "Disconnected nodes detected". Park unused nodes by wiring them somewhere and setting `disabled: true`. |
| **Credentials block saving** | A node with an unconfigured credential prevents the whole workflow from saving. Add the credential first, or leave the node out. |
| **Rate limits** | PyPI (`pypistats.org`) 429s on 21 parallel requests. Set `options.batching.batch = { batchSize: 1, batchInterval: 1500 }` plus `retryOnFail` / `maxTries: 3` / `waitBetweenTries: 3000`. |
| **`Merge` (append) waits for all inputs** | Never route a leg on a different trigger through a shared Merge — the run hangs waiting for an input that will never arrive. |
| **`WriteBinaryFile` overwrites** | Date-stamped names make a new file per day, but a rerun on the same day replaces that day's file. |
| **Canvas is live** | The workflow is `active`; a broken leg runs on schedule. Disable while testing. |

### Databricks access from this machine

The Databricks CLI is **not installed** (`databricks: command not found`), and
`databricks-sdk` is not in the Python environment. Two options:

```bash
# CLI (recommended — stores creds in ~/.databrickscfg, no .env parsing)
winget install Databricks.DatabricksCLI
databricks auth login --host https://dbc-0a49a6d2-f0ff.cloud.databricks.com

# or Python SDK
pip install databricks-sdk
```

Once authenticated, `databricks fs ls dbfs:/Volumes/momentum/momentum/landing`
verifies uploads without touching `.env` (which is blocked from agent file
tools by the Zed `private_files` setting).

---

## 10. Known Issues

| Issue | Impact |
|---|---|
| `TEMP CRON` enabled alongside `Cron · Daily 05:00` | manual trigger + schedule double-fires all 5 daily legs |
| `Databricks1` still connected from `Route` output 1 | inert (disabled), but should be deleted |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `Merge Validations` input indices shuffled | harmless (append mode) but confusing |
| USPTO zips exceed the 5 GiB upload cap | upload node will fail on those legs |
| `TRTYRAP` only newest part fetched | fragment, not the dataset |
| OpenAlex bypasses `Merge` | `Gate.totalFiles` reads 5 daily / 1 weekly |
| `WriteBinaryFile` overwrites | rerun on the same day replaces that day's file; USPTO zips have no date and always overwrite |
| `Slack · Approve Upload` channel is a placeholder | `channelId` set to `ingestion-alerts` by name — must be changed to the real channel |

---

## 11. Status

- ✅ Repo pushed to `AxiomLC/databricks-app` (public)
- ✅ Single n8n canvas, 7 legs, 3 shared triggers, active
- ✅ Databricks workspace / warehouse / catalog / Volume configured
- ✅ Lakebase `Admin` role verified (connect + DDL/DML + pgvector)
- ✅ All 7 legs tested against live APIs
- ✅ Validation + Gate + Slack approval + Volume upload wired
- ⏳ USPTO annual backfile (1 of 177 parts)
- ⏳ Silver/Gold not pointed at real tables
- ⏳ UI not built
