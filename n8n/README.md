# n8n ingestion

The n8n workflow that fetches public APIs **outside** Databricks and writes
date-partitioned JSONL to a local staging dir (`data/<source>/raw/`), which is then
pushed to the Unity Catalog Volume.

Snapshot in this folder: [`ingestion-master.json`](./ingestion-master.json) — a
Canvas export. The canvas is the source of truth; this file is a reference copy.

## Live canvas

There is **one** workflow, not one per source:

| | |
|---|---|
| Name | `databricks: Ingestion Master (All Legs)` |
| ID | `GQs6702n6vwYjKVa` |
| Nodes | 53 (2 sticky notes) |
| Connections | 48 |
| Status | active |

The 7 original per-source workflows were deleted. Everything lives on this canvas.

## Shape

```
Pillar Keywords ─┬─► arXiv HTTP    → Parse arXiv        → Write arXiv JSONL  → Validate arXiv  ─┐
                 ├─► HF HTTP       → Parse HF Models    → Write HF JSONL     → Validate HF     ─┤
                 ├─► GitHub HTTP   → Parse GitHub Repos → Write GitHub JSONL → Validate GitHub ─┤
                 ├─► Flatten PyPI ─► PyPI HTTP          → Parse PyPI Stats   → Write PyPI JSONL → Validate PyPI ─┤
                 ├─► Flatten npm ──► npm HTTP           → Parse npm Stats    → Write npm JSONL → Validate npm  ─┤
                 ├─► Write Pillars  (dangling → pillars.json)                                             │
                 └─► USPTO TMs → Find Latest TDXF → USPTO File List → Pick Latest File →                │
                                  Download TDXF File → Write TDXF → Extract USPTO Gems → Validate USPTO ┤
                                                                                                          │
                                  Merge Validations ──► Gate ──► Route ─┬─► Databricks                    │
                                                                        └─► Slack · Approve Upload → If1    │
                                                                                                    │       │
                                                            Expand Approved → Databricks            │       │
                                                                                                    │       │
Validate USPTO ────────────────► Databricks / Slack (bypasses Gate and Merge) ◄─────────────────────┘
```

Reading it as three lanes:

1. **The five scored legs** — arXiv, HF, GitHub, PyPI, npm. All end at
   `Merge Validations`, which feeds `Gate`.
2. **USPTO** — a separate lane that reaches `Validate USPTO` and goes straight to
   `Databricks`. It never touches `Merge Validations` or `Gate`.
3. **The exit** — `Route` sends clean batches to `Databricks` and blocked ones to
   Slack for human approval.

### Node count by role

| Role | Nodes |
|---|---|
| Triggers | `Cron · Daily 05:00` (disabled), `TEMP CRON`, `OpenAlex WEEKLY` (disabled), `Webhook · temp-debug`, `When clicking 'Execute workflow'` (disabled) |
| Fetch | `arXiv HTTP`, `HF HTTP`, `GitHub HTTP`, `PyPI HTTP`, `npm HTTP`, `USPTO TMs`, `USPTO File List`, `Download TDXF File` |
| Parse | `Parse arXiv`, `Parse HF Models`, `Parse GitHub Repos`, `Parse PyPI Stats`, `Parse npm Stats`, `Find Latest TDXF`, `Pick Latest File` |
| Write | `Write arXiv JSONL`, `Write HF JSONL`, `Write GitHub JSONL`, `Write PyPI JSONL`, `Write npm JSONL`, `Write TDXF`, `Write Pillars` |
| Validate | `Validate arXiv`, `Validate HF`, `Validate GitHub`, `Validate PyPI`, `Validate npm`, `Validate USPTO` |
| Extract | `Extract USPTO Gems` (Execute Command → `scripts/uspto_extract.py`) |
| Gate / route | `Merge Validations`, `Gate`, `Route`, `Slack · Approve Upload`, `If1`, `Expand Approved`, `Write Error to UI` (disabled) |
| Sink | `Databricks` |
| Config / notes | `Pillar Keywords`, `Flatten PyPI Packages`, `Flatten npm Packages`, `Read Pillars`, `Pillar Keywords2`, `Parse OpenAlex`, `OpenAlex HTTP`, `Write OpenAlex JSONL`, `Validate OpenAlex`, 2 sticky notes |

## Pillar Keywords — the only thing you edit

`Pillar Keywords` is a Code node emitting 5 items. Every leg reads from it.

```js
const PILLARS = [
  { pillar: 'self-hosted-vs-saas', keyword: 'self-hosted AI', hf: 'gguf',      pypi: [...], npm: [...] },
  { pillar: 'temporal-memory',     keyword: 'agent memory',  hf: 'memory',    pypi: [...], npm: [...] },
  { pillar: 'retrieval-engines',   keyword: 'approximate nearest neighbor', hf: 'graph', pypi: [...], npm: [...] },
  { pillar: 'data-persistence',    keyword: 'object storage', hf: 'storage',  pypi: [...], npm: [...] },
  { pillar: 'stack-structure',     keyword: 'lakehouse',     hf: 'lakehouse', pypi: [...], npm: [...] },
];
```

This node writes `pillars.json` at runtime. That file is an **output** — never
edit it. Full arrays with the `uspto` terms: `techREADME.md` §4.2.

| Field | Consumed by | Constraint |
|---|---|---|
| `keyword` | arXiv (`all:"..."`), GitHub (`q=`), OpenAlex (`title.search:"..."`) | free text, quoted as a phrase |
| `hf` | Hugging Face — **must be one word**, `search=` ignores phrases | single token |
| `pypi` | fanned out per package by `Flatten PyPI Packages` | PyPI-native names |
| `npm` | fanned out per package by `Flatten npm Packages` | npm-native names |
| `uspto` | `Extract USPTO Gems` → trademark goods/services matching | literal phrases; see `techREADME.md` §5.6.1 |

### The three `Pillar Keywords` nodes

There are three, and they are not interchangeable:

| Node | Fed by | Emits |
|---|---|---|
| `Pillar Keywords` | `Cron · Daily 05:00` | The master list. Writes `pillars.json` via `Write Pillars` |
| `Pillar Keywords2` | `Read Pillars` ← `OpenAlex WEEKLY` | Re-reads `pillars.json` off disk so the weekly leg uses the same list |
| `Pillar Keywords1` | — | **Removed.** It was the historical-USPTO copy and is no longer on the canvas |

## Schedules

| Trigger | Cron / rule | State | Legs |
|---|---|---|---|
| `Cron · Daily 05:00` | `0 5 * * *` | **disabled** | arXiv, HF, GitHub, PyPI, npm, USPTO Trademarks |
| `TEMP CRON` | every 27 days | enabled, **not connected** | nothing — inert |
| `OpenAlex WEEKLY` | weekly | **disabled** | OpenAlex via `Read Pillars` |
| `Webhook · temp-debug` | path `temp-debug` | enabled, **not connected** | nothing — inert |
| `When clicking 'Execute workflow'` | manual | **disabled**, not connected | nothing — inert |

Only `OpenAlex WEEKLY`'s *downstream* graph is live; its trigger is off. To run the
pipeline, enable `Cron · Daily 05:00` (or the manual trigger) and re-enable
`OpenAlex WEEKLY` for the weekly leg.

> `TEMP CRON`, `Webhook · temp-debug` and `When clicking 'Execute workflow'` are
> deliberately left in place during testing. Do not treat them as the entry points.

## Output

`data/<source>/raw/<pillar>-<YYYY-MM-DD>.jsonl`

| Source | File pattern |
|---|---|
| `arxiv` | `<pillar>-<date>.jsonl` |
| `huggingface` | `<pillar>-<date>.jsonl` |
| `github` | `<pillar>-<date>.jsonl` |
| `openalex` | `<pillar>-<date>.jsonl` |
| `pypi` | `<pillar>-<pkg>-<date>.jsonl` — one file per package |
| `npm` | `<pillar>-<pkg>-<date>.jsonl` — one file per package |
| `uspto` | `apc<YYMMDD>.zip` → `apc<YYMMDD>.jsonl` |

Every JSONL row is the canonical node shape:

```json
{"node_id":"...","kind":"paper|model|package|repo|trademark","name":"...","pillar":"<pillar-id>","source":"arxiv","raw_attrs":{...},"ingested_at":"..."}
```

## USPTO ODP — the two-call pattern

The search endpoint does **not** return download links. The USPTO leg needs a
product-detail call between search and download:

```
1. GET /api/v1/datasets/products/search?q=trademark&rows=100
     → { count, bulkDataProductBag: [ { productIdentifier, productTitleText, ... } ] }

2. GET /api/v1/datasets/products/{productIdentifier}
     → { bulkDataProductBag: [ { productFileBag: { fileDataBag: [
           { fileName, fileSize, fileDataFromDate, fileDownloadURI }
       ] } } ] }

3. GET {fileDownloadURI}   (same X-API-Key credential)
```

Product pinned by ID:

| Leg | `productIdentifier` | Description |
|---|---|---|
| Trademarks | `TRTDXFAP` | Daily applications, 682 files, updated daily |

Auth: `httpHeaderAuth` credential **`USPTO ODP`** (id `CLHwnbf3V3UIf1N4`), header `X-API-Key`. Header casing is irrelevant — `X-API-Key`, `X-API-KEY`, `x-api-key` all return 200.

⚠️ `q=trademark` also matches patents (`GZLST`, CPC files) because it searches descriptions. Always pin by `productIdentifier`.

⚠️ The `TRTYRAP` historical backfile (177 parts, ~10 GB) is **not on the canvas
any more** — that lane was removed. The backfile is a separate, deferred job.

⚠️ File bytes are capped at **6 downloads per file per 7 days**, and every request
counts including 429s. Never re-run the USPTO leg twice in one day — the second run
hits the same filename and burns quota.

⚠️ A zero-match day is **not** a failure. `uspto_extract.py` exits 0 when nothing
matches; `Validate USPTO` marks `quietDay: true` and uploads nothing. Thin weekend
dockets legitimately produce no hits.

## Testing

Schedule triggers can't be fired externally, and instance-level MCP
(`N8N_MCP_ACCESS_TOKEN`) is not configured. Options:

1. **Manual trigger** — re-enable `When clicking 'Execute workflow'` and wire it to
   the node you want to test, then click Execute in the editor.
2. **Webhook** — `Webhook · temp-debug` is on the canvas but disconnected. Wire it
   to `Pillar Keywords` (or any single node) and `GET
   https://n8n.airpg.ai/webhook/temp-debug`.
3. Inspect with `n8n_executions` (`mode: preview` or `filtered` — full mode returns
   megabytes of binary).
4. Remove the temporary wiring and run `cleanStaleConnections`.

⚠️ **Do not use a "direct" MCP test run on this workflow.** It starts whichever
trigger it finds and executes the *entire* graph — a full ingest — not just the
node you asked about.

## Gotchas

- **HTTP node splits JSON arrays** into one item per element. For top-level arrays (HF), set `responseFormat: text` and `JSON.parse` in the Code node.
- **WriteBinaryFile overwrites.** Any leg emitting multiple items per pillar must put the item identity in the filename (this is why PyPI and npm are `<pillar>-<pkg>-<date>`).
- **Parse nodes must loop `items`** and emit one output per input, or 5 pillars collapse into 1.
- **`pillar` is not in HTTP responses.** Read it from `Pillar Keywords` (or the Flatten nodes) by position.
- **Scoped npm names contain `@` and `/`.** `Write npm JSONL` and `Validate npm` must sanitize identically, or Databricks creates nested directories.
- **`Merge` (append) waits for all inputs.** Never route a leg on a different trigger through a shared Merge — the run hangs. This is why OpenAlex goes straight to `Gate`, and why USPTO bypasses Merge entirely.
- **Nested double quotes break under `cmd.exe`** in Execute Command nodes, and the failure can exit 0. Keep paths unquoted.
- **Draft vs published.** Executions run the *published* version; the editor loads the *draft*. After MCP edits, **publish**, or the editor shows stale content.
- **Canvas groups** must form a single connected subgraph with one entry and one exit, or n8n drops them on save.
- **OpenAlex** runs on the shared free budget ($0.10/day per IP). A free key gives $1/day via `api_key=`.

## Exports

`ingestion-master.json` is a canvas export kept for reference. Refresh it with
**Workflow → ⋯ → Download** after significant canvas changes.
