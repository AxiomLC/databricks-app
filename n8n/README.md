# n8n ingestion

Scheduled n8n workflows that fetch the public APIs **outside** Databricks and write
date-partitioned JSONL to a local staging dir (`data/<source>/raw/`), which is then
pushed to the Unity Catalog Volume.

## Live canvas

There is **one** workflow, not one per source:

| | |
|---|---|
| Name | `databricks: Ingestion Master (All Legs)` |
| ID | `GQs6702n6vwYjKVa` |
| Nodes | 32 (3 triggers, 21 connections) |
| Status | active |

The 7 original per-source workflows were deleted. Everything lives on this canvas.

## Shape

```
Cron · Daily 05:00 ──► Pillar Keywords ──┬─► arXiv HTTP    → Parse arXiv        → Write arXiv JSONL
                                         ├─► HF HTTP       → Parse HF Models    → Write HF JSONL
                                         ├─► GitHub HTTP   → Parse GitHub Repos → Write GitHub JSONL
                                         ├─► USPTO Bulk Products → Find Latest TDXF → USPTO TDXF Files
                                         │                       → Pick Newest TDXF → Download TDXF File → Write TDXF
                                         ├─► Flatten PyPI Packages → PyPI HTTP → Parse PyPI Stats → Write PyPI JSONL
                                         └─► OpenAlex HTTP → Parse OpenAlex Works → Write OpenAlex JSONL

Cron · OpenAlex Mon 09:00 ──► Pillar Keywords   (same node, second entry point)

Cron · USPTO Hist 1st 03:00 ──► USPTO Historical Products → Pick Latest Monthly
                              → USPTO Annual Files → Pick Newest Annual
                              → Download Monthly → Write Monthly
```

## Pillar Keywords — the only thing you edit

`Pillar Keywords` is a Code node emitting 5 items. Every leg reads from it.

```js
const PILLARS = [
  { pillar: 'graph-db',       keyword: 'graph database', hf: 'graph',     pypi: ['neo4j','kuzu','falkordb','memgraph','gremlinpython'] },
  { pillar: 'lakehouse',      keyword: 'lakehouse',      hf: 'lakehouse', pypi: ['deltalake','pyiceberg','duckdb','lance'] },
  { pillar: 'ai-memory',      keyword: 'agent memory',   hf: 'memory',    pypi: ['letta','mem0ai','zep-python','langmem'] },
  { pillar: 'hybrid-ram',     keyword: 'vector index',   hf: 'vector',    pypi: ['faiss-cpu','usearch','hnswlib','annoy'] },
  { pillar: 'object-storage', keyword: 'object storage', hf: 'storage',   pypi: ['boto3','minio','pyarrow','obstore'] },
];
```

| Field | Consumed by |
|---|---|
| `keyword` | arXiv (`all:"..."`), GitHub (`q=`), OpenAlex (`default.search:`) |
| `hf` | Hugging Face — **must be one word**, `search=` ignores phrases |
| `pypi` | fanned out per package by `Flatten PyPI Packages` |

## Schedules

| Trigger | Cron | Legs |
|---|---|---|
| `Cron · Daily 05:00` | `0 5 * * *` | arXiv, HF, PyPI, GitHub, USPTO Trademarks |
| `Cron · OpenAlex Mon 09:00` | `0 9 * * 1` | OpenAlex |
| `Cron · USPTO Hist 1st 03:00` | `0 3 1 * *` | USPTO Historical |

All five daily legs fire simultaneously. Add a Wait node per branch if staggering is needed.

## Output

`data/<source>/raw/<pillar>-<YYYY-MM-DD>.jsonl`

| Source | File pattern | Rows/pillar |
|---|---|---|
| `arxiv` | `<pillar>-<date>.jsonl` | 19 |
| `huggingface` | `<pillar>-<date>.jsonl` | 99 (lakehouse 19) |
| `github` | `<pillar>-<date>.jsonl` | 19 |
| `openalex` | `<pillar>-<date>.jsonl` | 49 |
| `pypi` | `<pillar>-<pkg>-<date>.jsonl` | 1 per package, 21 files |
| `uspto` | `tdxf-<file>.zip`, `annual-<file>.zip` | 1 zip each |

Every JSONL row is the canonical node shape:

```json
{"node_id":"...","kind":"paper|model|package|repo","name":"...","pillar":"graph-db","source":"arxiv","raw_attrs":{...},"ingested_at":"..."}
```

## USPTO ODP — the two-call pattern

The search endpoint does **not** return download links. Both USPTO legs need a product-detail call:

```
1. GET /api/v1/datasets/products/search?q=trademark&rows=100
     → { count, bulkDataProductBag: [ { productIdentifier, productTitleText, ... } ] }

2. GET /api/v1/datasets/products/{productIdentifier}
     → { bulkDataProductBag: [ { productFileBag: { fileDataBag: [
           { fileName, fileSize, fileDataFromDate, fileDownloadURI }
       ] } } ] }

3. GET {fileDownloadURI}   (same X-API-Key credential)
```

Products pinned by ID:

| Leg | `productIdentifier` | Description |
|---|---|---|
| Trademarks | `TRTDXFAP` | Daily applications, 682 files, updated daily |
| Historical | `TRTYRAP` | Annual applications backfile to 1884, 177 part files |

Auth: `httpHeaderAuth` credential **`USPTO ODP`** (id `CLHwnbf3V3UIf1N4`), header `X-API-Key`. Header casing is irrelevant — `X-API-Key`, `X-API-KEY`, `x-api-key` all return 200.

⚠️ `q=trademark` also matches patents (`GZLST`, CPC files) because it searches descriptions. Always pin by `productIdentifier`.

⚠️ `TRTYRAP` is 177 parts (~10 GB). The leg currently downloads only the newest part — a fragment, not the full dataset.

## Testing

Schedule triggers can't be fired externally, and instance-level MCP (`N8N_MCP_ACCESS_TOKEN`) is not configured. To test:

1. Add a temporary `Webhook` node (GET, path `temp-debug`).
2. Wire it to `Pillar Keywords` (and to `USPTO Historical Products` for the historical leg).
3. `GET https://n8n.airpg.ai/webhook/temp-debug`.
4. Inspect with `n8n_executions` (`mode: preview` or `filtered` — full mode returns megabytes of binary).
5. Remove the webhook and run `cleanStaleConnections`.

## Gotchas

- **HTTP node splits JSON arrays** into one item per element. For top-level arrays (HF), set `responseFormat: text` and `JSON.parse` in the Code node.
- **WriteBinaryFile overwrites.** Any leg emitting multiple items per pillar must put the item identity in the filename (this is why PyPI is `<pillar>-<pkg>-<date>`).
- **Parse nodes must loop `items`** and emit one output per input, or 5 pillars collapse into 1.
- **`pillar` is not in HTTP responses.** Read it from `Pillar Keywords` (or `Flatten PyPI Packages`) by position.
- **Canvas groups** must form a single connected subgraph with one entry and one exit, or n8n drops them on save.
- **OpenAlex** runs on the shared free budget ($0.10/day per IP). A free key gives $1/day via `api_key=`.

## Exports

No JSON exports are committed. The canvas is the source of truth — export from n8n
(`Workflow > ⋯ > Download`) if you want a snapshot in git.
