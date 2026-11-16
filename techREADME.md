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
notebooks/silver/      silver_nodes.py — JSONL → silver_nodes
notebooks/gold/        gold_momentum.py — silver → gold_level + gold_volume
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
  "pillar":      "string  — self-hosted-vs-saas | temporal-memory | retrieval-engines | data-persistence | stack-structure",
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
| `edge_id` | string | sha1 of edge_type + both endpoints — deterministic, so re-runs are idempotent |
| `edge_type` | string | see §3.4 |
| `src_node_key` | string | FK → silver_nodes.node_key |
| `src_node_id` | string | FK → silver_nodes.node_id (always a real node) |
| `dst_node_id` | string | real node **or** synthetic hub (`pillar:*`, `company:*`) |
| `weight` | double | 1.0 for membership/citation; reserved for weighted edges |
| `source` | string | upstream API |
| `observed_date` | date | partition key |

### 3.4 Edge types

| Edge | Rule | Status |
|---|---|---|
| `pillar_membership` | entity → `pillar:<id>` | ✅ 2,432 |
| `paper_citation` | OpenAlex `referenced_works[]` → `node_id` | ✅ 371 |
| `package_dependency` | PyPI `requires_dist` / npm `dependencies` → corpus | ✅ 13 |
| `repo_package` | registry repo URL slug → GitHub `node_id` | ✅ 5 |
| `trademark_company` | `strip_company_artifacts` canonical normalization | ✅ 1 |
| `arxiv_openalex` | arXiv ID ↔ OpenAlex DOI (`10.48550/arxiv.<id>`) | ✅ 0 (no corpus overlap) |
| `paper_model` | HF `arxiv_id` ↔ arXiv ID | ❌ needs per-model call (see below) |

#### `paper_model` — why it is deferred

The HF leg calls one endpoint: `GET /api/models?search=<kw>&limit=100`. That
returns a **list** with summary fields only (`id`, `downloads`, `likes`,
`pipeline_tag`). The arXiv ID lives in the model **card**, which is only returned
by the per-model endpoint:

```
GET /api/models/<org>/<name>   ->  cardData.arxiv = "2407.21783"
```

**Cost:** the list call is 1 request per 100 models; the detail call is 1 request
per model. At ~543 distinct models that is ~543 extra requests per run — a ~500×
increase against a free API.

**Expected yield:** most models have no arXiv ID (community fine-tunes,
quantizations, LoRAs). Estimated 10–20% hit rate → ~50–100 edges.

**Cheaper option if pursued:** fetch details only for models above a download
threshold (top ~50 per pillar ≈ 250 requests). Models with papers behind them
are the ones with meaningful download counts.

**Work required:** a new HTTP node with batching and retry, plus a join on the
extracted arXiv ID. Not a few lines in the parse node.

**Bipartite, not pairwise.** "Two entities share a pillar" as a pairwise edge is
O(n²) — one pillar with 543 models yields ~147,000 edges. Bipartite gives the
same information in linear space: one edge per `(entity, pillar)`.

**Synthetic hubs.** `pillar:*` and `company:*` are not rows in `silver_nodes`.
Pillars are not observed entities, so putting them in Silver would corrupt its
grain. The UI materialises them.

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

**Pillar set locked 2026-11-14 and applied.** This node is the only input; it
writes `pillars.json` at runtime (gitignored). Never edit `pillars.json` — it is
an output. Rationale: `archive/pillars_research_11_14_2026.md`; details §5.9.

```js
{ pillar: 'self-hosted-vs-saas', keyword: 'self-hosted AI',  hf: 'gguf',      pypi: ['ollama','llama-cpp-python','open-webui','langchain'] },
{ pillar: 'temporal-memory',     keyword: 'agent memory',   hf: 'memory',    pypi: ['mem0ai','zep-python','langmem','graphiti-core'] },
{ pillar: 'retrieval-engines',   keyword: 'approximate nearest neighbor', hf: 'graph', pypi: ['neo4j','kuzu','falkordb','memgraph','gremlinpython','faiss-cpu','usearch','hnswlib','annoy','qdrant-client','lancedb'] },
{ pillar: 'data-persistence',    keyword: 'object storage', hf: 'storage',   pypi: ['obstore','minio','s3fs','fsspec','cloudpathlib','smart-open'] },
{ pillar: 'stack-structure',     keyword: 'lakehouse',      hf: 'lakehouse', pypi: ['deltalake','pyiceberg','duckdb','pyarrow','openlineage-python','databricks-sdk'] },
```

Notes on the rewrite:

- `boto3` / `pyarrow` were **removed** from `data-persistence` — downloaded by
  everything, their noise floor swamps `obstore`. `pyarrow` moved to
  `stack-structure` where it is on-pillar.
- `letta` dropped from `temporal-memory` (superseded by `mem0ai` / `graphiti-core`).
- `retrieval-engines` merges the old `graph-db` + `hybrid-ram` lists, because
  graph / vector / keyword / columnar are now *contenders inside one arena*
  rather than separate pillars.
- `self-hosted-vs-saas` is the only pillar whose cloud side is not directly
  observable. See §5.9 for the measurement caveat.
- **`pypi` must be PyPI-native.** The pipeline has no npm leg, so `n8n` (492/mo)
  and `openclaw` (1,624/mo) are excluded despite being the headline self-hosted
  apps — their real traffic is npm. Adding an npm leg is the fix, not padding the
  list with stubs.
- `uspto` terms are **not** derived from `keyword`. Trademark prose shares almost no
  vocabulary with research or package registries — see §5.6.1. Do not point the
  USPTO leg back at `keyword`; that is what produced a zero-match docket.

| Field | Consumed by | Constraint |
|---|---|---|
| `keyword` | arXiv `all:"…"`, GitHub `q=`, OpenAlex `title.search:"…"` | free text; quoted as a phrase in arXiv and OpenAlex |
| `hf` | Hugging Face `search=` | **single word only** — HF ignores multi-word phrases |
| `pypi` | `Flatten PyPI packages` → one item per package | array |
| `npm` | `Flatten npm Packages` → one item per package | array; registry-native names |
| `uspto` | `scripts/uspto_extract.py` → trademark goods/services matching | array; **literal phrases** — see §5.6.1 |

### 4.3 Triggers

| Node | Rule | State | Fans out to |
|---|---|---|---|
| `Cron · Daily 05:00` | `0 5 * * *` | **disabled** | `Pillar Keywords` → arXiv, HF, GitHub, PyPI, npm, USPTO |
| `OpenAlex WEEKLY` | weekly | **disabled** | `Read Pillars` → `Pillar Keywords2` → OpenAlex |
| `TEMP CRON` | every 27 days | enabled, **unconnected** | nothing — inert scaffold |
| `Webhook · temp-debug` | path `temp-debug` | enabled, **unconnected** | nothing — inert scaffold |
| `When clicking 'Execute workflow'` | manual | **disabled**, unconnected | nothing — inert scaffold |

The two schedules are off while the UI work is in progress. Only `OpenAlex WEEKLY`'s
downstream graph is reachable; its trigger is off. The three scaffolds are left in
place deliberately during testing — do not treat them as entry points.

The historical USPTO lane (`USPTO MONTHLY Hist`, `Pillar Keywords1`, `USPTO
Historical Products`, `TRTYRAP` download) is **no longer on the canvas**. The
annual backfile is a separate deferred job.

⚠️ Never use an MCP `direct` test run on this workflow — it picks whichever
trigger it finds and executes the whole graph, i.e. a full ingest.

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
| Trademarks | `TRTDXFAP` | daily applications, 682 files — **the only USPTO leg on the canvas** |

- `q=trademark` also matches patents (`GZLST`, CPC) — always pin by `productIdentifier`.
- Header casing is irrelevant (`X-API-Key` / `X-API-KEY` / `x-api-key` all 200).
- The `TRTYRAP` annual backfile (177 parts, ~10 GB) is **not on the canvas**. That
  lane was removed; the backfile is a separate deferred job.

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
| Exit 0 | success — **including a zero-match day** |
| Exit 1 | bad input (missing zip / `pillars.json` / unreadable XML) |
| Exit 2 | no matches, **only with `--strict`** (default exits 0) |

Measured on `tdxf-apc261110.zip`: 62,981 cases → **5 matches** (ai-memory 3,
hybrid-ram 1, object-storage 1). Trademarks are ~0.008% relevant; the leg is
kept because the hits are high-signal (Elasticsearch B.V., FastS3 Inc.).

**A zero-match day is not a failure.** Thin weekend dockets and quiet news days
produce no hits at all. Exit 2 used to signal that loudly, which made execution
15773 halt at `Extract USPTO Gems` on the 2026-11-14 Sunday file. The script now
exits 0 by default; `--strict` restores the old behaviour for one-off checks.
`Validate USPTO` additionally tolerates exit 2, marks the item `quietDay: true`,
and passes **no binary** when the JSONL has zero rows so nothing empty is uploaded.

#### 5.6.1 USPTO term calibration

Trademark goods/services prose is written by lawyers to a Class 9 / Class 42
template, not by engineers. The `keyword` field is therefore useless here:
`approximate nearest neighbor` and `self-hosted AI` matched **0 of 7,430**
filings, and `object storage` / `lakehouse` matched 0 as well. That is why the
leg needs its own `uspto` array.

Measured on `apc261114` (Sunday, 7,430 filings), filings matched per pillar with
the shipped `uspto` arrays:

| Pillar | Filings | Strongest terms |
|---|---|---|
| `self-hosted-vs-saas` | 568 | `software as a service` 291, `online non-downloadable` 247 |
| `data-persistence` | 182 | `database` 147, `database management` 44 |
| `temporal-memory` | 70 | `chatbot` 35, `digital assistant` 21 |
| `stack-structure` | 64 | `data analytics` 29, `application programming interface` 28 |
| `retrieval-engines` | 53 | `search engine` 24, `searchable database` 14 |

Rules for editing these terms:

- **Literal phrases only.** The matcher is word-bounded and plural-tolerant on the
  final word; punctuation is escaped as-is, so `on-premises` and `on premises` are
  different terms. Prefer spelling variants explicitly (`online` *and* `on-line`).
- **Two words minimum**, except where a single word is unambiguous in this domain
  (`database`, `chatbot`, `interoperability`). Bare `storage` was rejected — it
  matches self-storage units and warehouse rental. Bare `software` matches most
  of the docket.
- **Zero-count terms are kept deliberately** where they are exact pillar
  vocabulary (`retrieval-augmented generation`, `graph database`, `delta lake`,
  `apache iceberg`, `open table format`, `interoperability`). They cost nothing
  and fire the day a genuine filing lands in that niche.
- **Expect cross-pillar bleed** on `searchable database` (retrieval *and*
  persistence) and on `data analytics` / `application programming interface`.
  Attribution is first-match-wins, so pillar order in the array matters.

Caveat: these counts come from a single Sunday docket, which is the thinnest
sample in the week. The pillars with deep vocabulary (SaaS, database) are solid;
`temporal-memory` and `stack-structure` rest on proxies and should be re-measured
once there is a weekday docket with hits to compare against.

### 5.7 `pillars.json` — shared pillar definitions

`Pillar Keywords` (Code node) remains the single source of truth. A dangling
`Write Pillars` node (`n8n-nodes-fs.writeFile`) hangs off it and overwrites
`pillars.json` in the repo root each run. The Python extractor reads that file.

A Code node has no filesystem access, so it cannot read the JSON itself — the
write direction is the only way to share without duplicating the list.

`pillars.json` is gitignored (runtime artifact).

### 5.8 OpenAlex query shape

`OpenAlex HTTP` uses `filter=title.search:"<keyword>"` — the keyword is wrapped
in literal quotes before `encodeURIComponent`, so OpenAlex matches it as an
exact phrase in the title only.

This replaced `default.search`, which is a noisy alias for `fulltext.search`.
Measured on `graph database`: `default.search` + `cited_by_count:desc` returned
ImageNet, BLAST and LeNet; `title.search` quoted returned Freebase, "Survey of
graph database models" and "Query languages for graph databases".

`hybrid-ram` was also changed from `vector index` (79 hits, mostly GIS and
signal-processing) to `approximate nearest neighbor` (729 hits, top-10 all
on-pillar: HNSW, FAISS, LSH, Annoy).

### 5.9 Pillars — locked 2026-11-12

Research response landed (`archive/pillars_research_11_12_2026.md`,
`archive/pillars.arenas.json`). The pillars are now **competitive arenas**:
each asks which approach is gaining adoption share, not which keyword is gaining
mentions. Every scored entity gets **one primary arena**; cross-arena
dependencies are graph edges, not duplicate score entries.

| # | Pillar | id | The contest |
|---|---|---|---|
| 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` | run the orchestration yourself vs rent it |
| 2 | Temporal Memory & Context | `temporal-memory` | evolving state vs flat recall |
| 3 | Retrieval Strategy | `retrieval-engines` | joins · hops · keyword · vector · columnar |
| 4 | Where Durable State Lives | `data-persistence` | local disk vs object store vs managed cloud |
| 5 | Open Format vs Integrated Platform | `stack-structure` | who owns the stack |

**Why the old set was replaced:**

| Old pillar | Problem | Resolution |
|---|---|---|
| `hybrid-ram` | Conflated RAM-resident graph with vector search — two different axes | Split: storage medium → `data-persistence`, retrieval method → `retrieval-engines` |
| `lakehouse` | Overlapped `object-storage` — both claimed table formats and cloud persistence | Merged into `stack-structure` (ownership), storage moved to `data-persistence` |
| `graph-db` | Was a *category*, not a contest | Absorbed into `retrieval-engines` as one contender among five |
| `ai-memory` | Fine, but named as a category | Renamed `temporal-memory`, framed as evolving-state vs flat-recall |

**Two axes, not one.** The old set mixed *data model* (how state is shaped and
queried) with *deployment* (where the bytes physically live). They are
orthogonal — Neo4j is native-graph + local-disk, HydraDB is native-graph +
object-store, Postgres-with-edge-tables is tables + local-disk. Every product is
a coordinate, not a camp member. `retrieval-engines` owns the model axis;
`data-persistence` owns the deployment axis.

**Vector is a capability, not a camp.** Every engine now ships an ANN index
(`pgvector`, Elasticsearch vectors, Neo4j vector indexes, Qdrant filters). So
`retrieval-engines` is not "graph vs vector" — it is *does the specialist
survive, or does one engine absorb everything?* That is the answerable question.

**`temporal-memory` is a real contest, not a feature.** Big vendors are bolting
timestamps onto existing stores; HydraDB claims native temporal handling is
faster and cleaner. The pillar measures whether native temporal products gain
share against retrofitted timestamp columns.

**Measurement caveats — read before building charts:**

| Pillar | Caveat |
|---|---|
| `self-hosted-vs-saas` | Self-hosted side is observable (npm/PyPI). SaaS side is **not** — GHL/Monday/Zapier publish no counts. Only IDE extensions have public installs (VS Code Marketplace, Open VSX). Either publish the SaaS side as a flat baseline with the caveat visible, or narrow the pillar to self-hosted apps vs cloud APIs and use the `ollama`/`openai` download ratio as the cloud proxy. **Open question: a separate SaaS data source may be added.** |
| `temporal-memory` | `agent memory` is the right OpenAlex lead; HF and trademark evidence are supporting context only. Generic `memory` is heavily polysemous. |
| `retrieval-engines` | The relational baseline (Postgres) is nearly invisible in all six sources — `psycopg2`/`asyncpg` growth is flat noise. The pillar can show graph/vector *gaining*, not tables *losing*. Track `psycopg`, `asyncpg`, `sqlalchemy`, `duckdb` as a baseline cohort and label it as such. |
| `data-persistence` | Generic packages (`boto3`, `fsspec`) dominate raw download counts. Score per-package growth, never cohort sums. |
| `stack-structure` | HF is a poor detector of enterprise platforms. Do not infer Databricks adoption from SDK downloads alone. |

**Scoring model (not yet implemented).** Research recommends growth over counts:
smoothed log growth per source, robust-z against a trailing baseline, combined
across four evidence families — research 25% (arXiv + OpenAlex as **one**
family), developer activity 30% (GitHub), package adoption 35% (PyPI), commercial
intent 10% (USPTO). HF sits at **0% in the core score**, context overlay only.
Missing families renormalize; they never score zero. Confidence shrinks sparse
results toward the midpoint. Breakout requires positive momentum in ≥2
independent families.

**This needs snapshot history we do not have yet.** PyPI Stats retains only 180
days, so daily snapshotting is now the gating prerequisite for any of the above.

**Two research deliverables are missing** from `archive/`:
`arena_query_plan_60.csv` and `arena_trend_intelligence_plan.json`. The arena
definitions alone are not enough to rewrite the queries.

**OpenAlex syntax conflict.** Research recommends the scoped parameters
`search.title` / `search.title_and_abstract` and calls `filter=title.search:`
legacy. §5.8 documents the current implementation as `filter=title.search:"…"`.
Verify against the live API before rewriting.

---

## 6. Databricks Processing

All three stages are **full rebuilds**, not incremental merges. Bronze is the
immutable archive, so a re-run is always correct and never depends on prior
state. This is why re-running a notebook is cheap and safe.

| Stage | Notebook | Action |
|---|---|---|
| Bronze | — | raw JSONL at `/Volumes/momentum/momentum/landing/<source>/`, as-landed, never edited |
| Silver | `notebooks/silver/silver_nodes.py` | read JSONL → type → dedup → `silver_nodes`, one row per `(node_id, pillar, observed_date)` |
| Silver | `notebooks/silver/silver_edges.py` | `silver_nodes` → `silver_edges`, bipartite entity→pillar edges |
| Gold | `notebooks/gold/gold_momentum.py` | → `gold_level` (per-entity metrics, long format) + `gold_volume` (entity counts) |

### 6.1 Platform concepts — where each term belongs

These are used loosely; the distinction matters when debugging.

| Term | What it is | Where it appears |
|---|---|---|
| **Lakehouse** | Architecture: object storage + warehouse table semantics. Not a product. | The whole Databricks layer |
| **Delta Lake** | Table format. ACID transactions, schema enforcement, time travel, via `_delta_log` beside the data files. | `silver_nodes`, `gold_level`, `gold_volume` |
| **Parquet** | Columnar compressed file format. The physical storage inside every Delta table. | Never accessed directly |
| **Volume** | A permissioned folder in UC storage. Holds **files**, not rows. | Bronze (`landing/`) |
| **Delta table** | Files + transaction log, queryable by name. Holds **rows**. | Silver, Gold |

**Volume vs table is the key distinction.** Bronze is files (read by path). Silver
and Gold are tables (read by name). A Volume cannot be queried with `SELECT`; a
table cannot be listed with `fs ls`.

**Not a database in the RDBMS sense.** No server holding rows in memory, no
user-tuned indexes, no connection pool. `PARTITIONED BY` is a directory layout,
not an index — which is why partitioning on a millisecond timestamp produced 123
partitions for 1,849 rows, and why both Silver and Gold partition on
`observed_date` instead.

**Implication for the app:** Databricks is archive + compute, not a serving
database. The UI must not query Delta on every page load. Lakebase (managed
Postgres) is the serving copy.

### 6.2 Known data quirks

| Quirk | Detail |
|---|---|
| npm `series` exploded | npm rows carry 7 days of per-day downloads. Gold explodes them into `downloads_day` rows dated by **series day**, giving npm real history back to 2026-11-08 — a week before Silver started. The final day is dropped (npm returns 0 for the unfinished day). |
| Double-count across pillars | Silver tags an entity once per matching pillar, so a 4-pillar repo appears 4× with the same star count. Charting one pillar is correct; summing across all pillars double-counts. Use `gold_volume.node_count` for distinct totals. |
| Bronze holds pre-fix bare IDs | n8n began emitting `npm:minio` / `pypi:minio` on 2026-11-14, but Bronze files from before that carry bare names and are never rewritten. **Silver re-applies the prefix on read**, so the table is consistent regardless of file age. The notebook prints how many rows needed it — zero is normal; a jump means n8n regressed. |
| HF `downloads` is cumulative | Lifetime total, not a daily rate. Never sum with `downloads_day`. |
| Growth columns not built | `growth_7d` / `growth_30d` need a full window. Silver started 2026-11-11, so 7-day deltas are computable from ~2026-11-18. |
| npm `downloads_7d` removed | Rolling 7-day total with no per-day breakdown, so it could not show momentum. Superseded by the exploded series. |

---

## 7. UI (AppKit / React)

Built in `ui/`, renders real data from a snapshot. Port `5180` (`strictPort`).

**Rendering stack:** **Cytoscape.js** for the graph — locked. Plain JS, no
Databricks dependency, runs inside a Databricks App. Databricks itself ships no
graph/network chart type and makes no library recommendation; its native viz is
bar/line/scatter/pie only.

### 7.1 Screens

| Screen | Reads | Purpose |
|---|---|---|
| Momentum Board | `gold_level` + `gold_volume` | time-series per pillar per signal; divergence view |
| Graph Explorer | `silver_nodes` + `silver_edges` | 2D network graph (Cytoscape.js) |
| Ask + Lineage | Genie | NL Q&A with lineage cards |
| Setup / Pillars | `pillars.json` | edit the 5 pillars and their keywords |
| Logs | n8n executions | run history, failures, gate decisions |

### 7.2 Graph Explorer — what makes it valuable

**2D is primary, not 3D.** Most 3D graph explorers are demos that answer nothing.
The dataset is small (~1.1k nodes, edges likely 2–5k) so performance is not the
constraint — readability is. 3D rotation actively hurts comprehension here.

What earns its place:

| Feature | Why it is the value |
|---|---|
| **Pillar clusters** | The interesting thing is not the nodes but which pillars *share* entities — that is where the contests actually overlap |
| **Momentum as colour, scale as size** | Colour = rate of change (Gold), size = absolute level. Separates "big and stalling" from "small and accelerating" |
| **Time scrubber** | Drag through days and watch clusters form. Highest-value interaction — turns a static map into the thesis. Notched for the recent 10 days. |
| **Path tracing** | Trademark → packages → repos → papers. The paper-to-revenue story, and the one thing no single source can show |
| **Edge type as line style** | Solid = citation, dashed = same-package, dotted = trademark-company. Without this, edges are meaningless spaghetti |

**Skip:** free-floating 3D rotation, physics that never settles, labels on every
node. If a user cannot answer "which pillar is accelerating" in under 10 seconds,
the graph failed.

**Status:** `silver_edges` is built (2,796 rows, 5 edge types) and the graph renders
it. The remaining question is whether the result is *useful*, not whether it can be
drawn.

### 7.2.1 Two renderers, one model

Graph Explorer can render with either engine, toggled in the toolbar:

| Engine | Library | Physics | Notes |
|---|---|---|---|
| Cytoscape | `cytoscape` + `cytoscape-fcose` | fcose (single-shot, deterministic) | Original. Best layout quality; no live physics |
| Force Graph | `react-force-graph-2d` | `d3-force-3d` (live simulation) | Draggable nodes, live settling, canvas-painted labels |

**The split is deliberate.** `views/graphModel.js` builds a neutral
`{ nodes, links }` model from the snapshot; `CytoscapeGraph.jsx` and
`ForceGraphView.jsx` are pure renderers over it. Data shaping happens once, so
adding a third engine (Sigma.js, Cosmograph) means one new renderer file and no
changes to filtering or momentum logic.

**Parameters.** Each engine declares its own knob schema in `graphModel.js`
(`CY_SCHEMA`, `FG_SCHEMA`) with defaults alongside (`CY_DEFAULTS`, `FG_DEFAULTS`).
`ParamModal.jsx` is generic — it renders whatever schema it is handed. The two
sets are not comparable: fcose is a one-shot solver (repulsion, edge length,
gravity, iterations), d3 is a live simulation (charge, link distance, velocity
decay, alpha decay, cooldown).

**Labels in force-graph.** `nodeLabel` is only a hover tooltip. Real per-node text
requires `nodeCanvasObject`, which hands you the raw 2D context — so the renderer
paints the disc, the stroke halo, and the text itself. Label modes: `none`
(hover only), `hubs` (pillar hubs only, the default), `all`. `labelMinZoom` gates
them by zoom; keep it low (0.35) because the fit zoom for ~180 nodes is well under
1.0 and a higher floor hides every label on first paint.

**Lazy loading.** `ForceGraphView` is `React.lazy`-loaded, so the ~206 kB
force-graph chunk is fetched only when the engine is first selected. Cytoscape
sessions never download it. Verified: no chunk request until the toggle is used.

**Zoom speed — measured, not guessed.** The two engines do not zoom at the same
rate per wheel notch, and the gap is large:

| `wheelSensitivity` | Cytoscape per notch | Force Graph per notch |
|---|---|---|
| `0.2` | 1.009× | 1.181× |
| `1.0` (default) | 1.047× | 1.181× |
| **`3.8` (current)** | **1.191×** | **1.181×** |

Cytoscape's `isWheelNotch` path divides the delta by `inaccurateScrollFactor`,
which throttles genuine mouse notches — so the default feels sluggish next to
force-graph. `3.8` brings them within 1% of each other. Cytoscape logs a
cosmetic warning about non-default wheel sensitivity; parity is worth more than
the clean console. If you change one engine's zoom feel, re-measure both.

**Two gotchas found while wiring this:**

- `force-graph` depends on **`d3-force-3d`**, not `d3-force`. Importing `forceX`
  from the wrong package silently gives you forces that never attach.
- force-graph **stops painting once the simulation cools**, so a label-only param
  change never reaches the canvas. Call `fgRef.current.refresh()` when
  paint-affecting params change.

**Edge count bug (fixed).** The old counter used `data.source !== undefined` to
detect edges, but entity *nodes* also carry a `source` field — so it reported
nodes + edges (414) instead of edges (235).

### 7.2.2 Panels — Genie (left) and Viewer (right)

The stage is three columns: `Genie | graph | Viewer`. Both side panels toggle
from the toolbar; the graph takes whatever width is left.

**Viewer is a state timeline, not a set of booleans.** Modelled on the Frontal
Lobe Viewer. Three state kinds:

| Kind | Payload | Produced by |
|---|---|---|
| `node` | one entity or hub | graph click, result-row click |
| `results` | query + matching rows | search bar (Enter) |
| `genie` | question + answer + SQL | Genie Conversation API (not wired) |

Rules: consecutive duplicate node clicks dedupe; a push after Back truncates the
forward path; capped at 50; Back is pure state restore and never re-runs a query
or moves the graph. Selecting a result row calls `onNavigate`, which asks the
active renderer to `focus(id)` and then pushes a `node` state.

**Search is local and instant.** It filters the *currently visible* graph by
label substring — no backend, no embeddings. It cannot find nodes filtered out
by the pillar selector or the date slider. Semantic search would need embeddings
in the pipeline; Cypher would need a graph database. Neither exists.

**Genie is an iframe, and that is a hard limit.** The panel renders the Genie
Agent via `<iframe>`, with the embed `src` pasted from the agent's
**Share → Embed space** dialog and kept in `localStorage`.

Two constraints that decide the architecture:

1. **A workspace admin must allowlist the embedding origin** (Settings → Security
   → External access → Embed dashboards). The allowlist is empty by default, so
   the frame renders blank until that is done — regardless of how correct the
   `src` is.
2. **The iframe is cross-origin, so its contents are unreadable.** Genie's answer
   cannot be lifted out of the frame and into the Viewer. Piping answers into the
   Viewer requires the **Genie Conversation API** (stateful, returns generated
   SQL + results), which needs a backend to hold credentials.

So the `genie` Viewer state exists and renders, but nothing produces it yet. That
is the seam where the Conversation API plugs in.

### 7.3 Charts, AI access, and controls

| Element | Detail |
|---|---|
| **Charts** | Bar, line, pie — Databricks native AI/BI dashboards. No custom charting needed. |
| **AI access** | MCP server so an AI client can read the Gold tables directly |
| **Ingest toggles** | Per-leg on/off switches for the 7 sources |
| **Cron toggle** | Enable/disable the daily schedule without editing the workflow |
| **Logs** | Execution history, validation failures, gate decisions |
| **Setup / Pillars** | User-editable pillar list and keywords — writes `pillars.json` |

### 7.4 Screenshot harness — how an agent sees the UI

`ui/.shot.mjs` is a Playwright script that captures the running UI. It exists so a
coding agent can look at the rendered page instead of guessing from source.

**Prerequisites:** dev server up (`cd ui && npm run dev`, port 5180), and Playwright
installed globally at `C:/Users/q1fre/node_modules/playwright` (v1.52, chromium
bundled). The script imports it by absolute `file:///` URL because it lives outside
the project's `node_modules`.

```bash
node ui/.shot.mjs                    # writes to %TEMP%
node ui/.shot.mjs C:/path/to/dir     # writes to a chosen directory
```

It captures two PNGs — `shot-board.png` (default tab) and `shot-graph.png` (after
clicking **Graph Explorer**, with a 6 s settle for the fcose layout) — and prints
canvas dimensions, visible body text, and all console messages as JSON.

**Reading the result depends on the agent's model:**

| Agent capability | Tools |
|---|---|
| **Vision-capable** | `read_file` on the PNG — returns the image as visual content. Copy it into the project first (e.g. `.shots/`), since `read_file` cannot reach `%TEMP%`. |
| **Text-only** | No pixel access. Use the JSON the script prints (console errors, body text, canvas size) plus DOM geometry checks via `page.evaluate` — bounding-box overlap, clipping, computed styles, contrast ratios. |

A text-only agent can still catch real defects this way: the harness surfaced two
Cytoscape warnings on first run — an invalid `node[type="entity"]:hover` selector
and a non-default `wheelSensitivity`.

**Reading the graph screenshot:** the pillar dropdown defaults to the first pillar
(`PILLARS[0].id`), so the graph shows ~179 nodes / ~414 edges, not the full
snapshot. That is intended — 1,015 nodes at once is an unreadable blob. Select
**All pillars** to see the whole graph, or pass a different default in the script.

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
| **Error flow never exercised** | `Route` → `Slack · Approve Upload` → `If1` → `Expand Approved` is wired but untested. A real failure may not reach Slack |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `Slack · Approve Upload` channel is a placeholder | `channelId` set to `ingestion-alerts` by name — must be changed to the real channel |
| `Merge Validations` input indices shuffled | harmless (append mode) but confusing |
| OpenAlex bypasses `Merge` | `Gate.totalFiles` reads 6 daily / 1 weekly |
| `WriteBinaryFile` overwrites | rerun on the same day replaces that day's file; USPTO zips have no date and always overwrite |
| Inert scaffolds on canvas | `TEMP CRON`, `Webhook · temp-debug`, `When clicking 'Execute workflow'` are all unconnected — harmless, but easy to mistake for entry points |

---

## 11. Status

- ✅ Repo pushed to `AxiomLC/databricks-app` (public)
- ✅ Single n8n canvas, 7 legs, 3 shared triggers, active
- ✅ Databricks workspace / warehouse / catalog / Volume configured
- ✅ Lakebase `Admin` role verified (connect + DDL/DML + pgvector)
- ✅ All 7 legs tested against live APIs
- ✅ Validation + Gate + Slack approval + Volume upload wired
- ✅ **Silver** — `silver_nodes` built from Bronze JSONL, 2,432 rows, idempotent
- ✅ **Registry-qualified IDs** — Silver re-applies the `npm:`/`pypi:` prefix on read, so pre-fix Bronze files are handled without rewriting the archive
- ✅ **Gold** — `gold_level` (~3,900 rows) + `gold_volume` (63 rows), idempotent
- ✅ **npm daily series** — exploded into `downloads_day`, 7 days of real history (2026-11-08 → 11-14)
- ✅ `node_id` registry-qualified (`npm:minio` vs `pypi:minio`)
- ✅ **`silver_edges`** — 2,796 edges across 5 types, idempotent
- ✅ **OpenAlex `referenced_works`** — 371 citation edges inside the corpus
- ✅ **Package metadata** — PyPI `requires_dist` / `project_urls`, npm `dependencies` / `repository.url`; 13 dependency + 5 repo edges
- ✅ **UI** — four views built, rendering a snapshot of real warehouse data
- ✅ **USPTO `uspto` terms** — calibrated against a real docket; zero-match days no longer fail (§5.6.1)
- ⏳ `paper_model` — needs a per-model HF call; not in `/api/models`
- ⏳ Growth columns — need a full window (7-day from ~2026-11-18). npm already has enough history to compute now.
- ⏳ USPTO annual backfile — deferred, not on the canvas
- ⏳ **Error flow untested** — no forced failure has been run through `Route` → `Slack · Approve Upload` → `If1` → `Expand Approved`
- ⏳ **Daily cron disabled** — runs are manual during UI work
- ⏳ **Databricks App** — port the UI to AppKit for live warehouse queries (see `HANDOVER.md`)
