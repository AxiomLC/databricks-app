# HANDOVER — Current State & Next Steps

Short status for resuming work. Full technical detail: [`techREADME.md`](./techREADME.md).
Plain-language guide: [`humanREADME.md`](./humanREADME.md).

## Where we are

**Phase: TESTING.** Pipeline runs end to end. Remaining: exercise failure paths,
then Silver/Gold, then the UI.

**Repo:** `AxiomLC/databricks-app` (public, GitHub).

**Ingestion (n8n):** `databricks: Ingestion Master (All Legs)` (`GQs6702n6vwYjKVa`),
active, 52 nodes / 4 triggers.

### Flow

```
Cron 05:00 ─┬→ Pillar Keywords ─┬→ arXiv / GitHub / HF / PyPI → Parse → Write → Validate ─┐
            │                   └→ Write Pillars (dangling → pillars.json)                  │
            │                                                                              ├→ Merge → Gate → Route
            └→ USPTO TMs → Find Latest TDXF → USPTO File List → Pick Latest File           │
                         → Download TDXF → Write TDXF → Extract USPTO Gems → Validate ──────┘
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

- 7 legs: arXiv, HF, PyPI, GitHub, OpenAlex, USPTO Trademarks, USPTO Historical
- USPTO hangs off the crons, not `Pillar Keywords` — bulk data has no per-pillar dimension
- `Gate` holds `ALLOW_PARTIAL = false` — any failing leg halts **all** uploads

### Verified

- **Volume** — 36 files confirmed via CLI (`arxiv` 5, `github` 5, `huggingface` 5, `pypi` 21), content read back as valid JSONL.
- **USPTO extraction** — `scripts/uspto_extract.py`: 62,981 cases → 5 matches in 13.5 s.
- **Databricks CLI** — v1.26.0 installed, profile `DEFAULT` valid.
- **Lakebase** — connect + CREATE/INSERT/SELECT/DROP verified.

### Corrections to earlier notes

- Exec `15697` was **not** clean: USPTO returned `[]` (read `products` instead of
  `bulkDataProductBag`) and OpenAlex never ran. The "55 MB" figure came from local
  staging, not that execution.
- `Cron · Daily 05:00` is **disabled**; only `TEMP CRON` fires.
- OpenAlex is now reachable: `OpenAlex WEEKLY` is enabled and reads `pillars.json`
  via `Read Pillars` → `Pillar Keywords2`. Exec `15707` ran the full leg clean
  (5/5 `ok`, 49 rows/file).

### Open items

- **Pillars locked 2026-11-12** — reframed as competitive arenas. Research
  response landed at `archive/pillars_research_11_12_2026.md` +
  `archive/pillars.arenas.json`. Full rationale and caveats in `techREADME.md` §5.9.

  | # | Pillar | id |
  |---|---|---|
  | 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` |
  | 2 | Temporal Memory & Context | `temporal-memory` |
  | 3 | Retrieval Strategy | `retrieval-engines` |
  | 4 | Where Durable State Lives | `data-persistence` |
  | 5 | Open Format vs Integrated Platform | `stack-structure` |

  Old set (`graph-db`, `lakehouse`, `ai-memory`, `hybrid-ram`, `object-storage`)
  is retired. `hybrid-ram` conflated storage medium with retrieval method;
  `lakehouse` overlapped `object-storage`. Both fixed by splitting the two axes:
  **data model** → `retrieval-engines`, **deployment** → `data-persistence`.

  **Not yet applied to the pipeline.** `Pillar Keywords` still emits the old
  ids and keywords. Rewrite is tomorrow's work.

- **SaaS side of pillar 1 is unmeasured.** GHL/Monday/Zapier publish no download
  counts. Only IDE extensions have public installs. Open question: add a separate
  SaaS data source. Until then, publish the SaaS side as a flat baseline with the
  caveat visible, or narrow the pillar to self-hosted apps vs cloud APIs using the
  `ollama`/`openai` download ratio.

- **Snapshotting is now the gating prerequisite.** The research scoring model
  (growth, robust-z, share-of-arena) needs trailing history. PyPI Stats keeps only
  180 days. Every day without snapshots is history that cannot be recovered.

- **Two research deliverables missing** from `archive/`:
  `arena_query_plan_60.csv` and `arena_trend_intelligence_plan.json`. Arena
  definitions alone are not enough to rewrite the queries.

- **OpenAlex query fixed.** `default.search` → `title.search:"<keyword>"` (phrase,
  title-only). `hybrid-ram` keyword changed `vector index` →
  `approximate nearest neighbor`. Note: research recommends the scoped
  `search.title` param and calls `filter=title.search:` legacy — verify against the
  live API before rewriting.

### Measured 2026-11-12 (last 30 days)

Pulled to test whether pillar 1 is observable. It is, on the self-hosted side.

| Package | Registry | Downloads/mo |
|---|---|---|
| `openai` | PyPI | 295,856,631 |
| `@anthropic-ai/sdk` | npm | 236,775,668 |
| `langchain` | npm | 15,013,679 |
| `ollama` | PyPI | 13,275,724 |
| `openclaw` | npm | 11,478,871 |
| `n8n` | npm | 535,616 |
| `llama-cpp-python` | PyPI | 519,085 |
| `n8n-nodes-base` | npm | 396,714 |
| `anthropic` | npm | 63,923 |
| `hermes` | npm | 1,422 |
| `open-webui` | npm | 355 |

- **`ollama` / `openai` ratio ≈ 4.5%.** Local model serving is real but small
  against cloud API usage.
- **`openclaw`** ("multi-channel AI gateway with extensible messaging
  integrations") is 11.4M/mo — 20× `n8n`. Verify it is not a dependency-of or CI
  mirror before charting: 275 MB unpacked × 11.4M ≈ 3 PB/mo of npm bandwidth.
- **`hermes` on npm is a different package.** Our Hermes has no npm/PyPI presence —
  GitHub only. Not measurable as a download series.
- **`open-webui` on npm is a stub** (355/mo). Real distribution is Docker + GitHub.
- **`n8n` npm is separable from n8n Cloud** (Cloud does not install the package),
  but includes Docker builds and CI — treat as an index, not a headcount.
- **Emerging thesis:** "local AI" is not winning; **self-hosted orchestration over
  cloud models** is. The top-left quadrant (self-hosted app + cloud API) carries
  the mass; the bottom-right (SaaS app + local weights) is nearly empty.

## What's next

1. **Apply the locked pillars to the pipeline.** Rewrite `Pillar Keywords` with the
   five new ids and keyword/PyPI lists from `techREADME.md` §4.2. Then re-run one
   leg and confirm `pillars.json` carries the new ids end to end.
2. **Start snapshotting.** PyPI Stats keeps 180 days only; the research scoring
   model cannot run without trailing history. This gates everything downstream.
3. **Error test with Slack.** Approval branch has never fired. Force a failure and
   confirm Approve/Decline work from mobile, `Expand Approved` rebuilds payloads,
   Decline stops cleanly.
4. **OpenAlex is unreachable from the daily path** — its trigger is disabled and it
   is not in the cron fan-out.
5. **Error flow: don't halt everything on a USPTO failure.** Consider per-leg
   severity so a USPTO failure alerts Slack/UI but still uploads healthy legs.
6. **USPTO annual backfile** — `TRTYRAP` is 177 parts (~10 GB); leg disabled.
7. **Silver/Gold** — `silver_nodes.py` still reads parquet from the wrong path;
   Bronze is JSONL at `/Volumes/momentum/momentum/landing/<source>/`.
8. **UI** — Momentum Board, 3D Graph Explorer, Genie Ask + Lineage. Each pillar has
   a natural chart shape: pillar 1 two-column split, 2 timeline, 3 five-way race,
   4 stack diagram, 5 two poles.
9. **Optional:** OpenAlex API key ($0.10/day per IP → $1/day).

## Cleanup owed

| Item | Action |
|---|---|
| `Webhook · temp-debug` | testing scaffold — remove when done, then `cleanStaleConnections` |
| `TEMP CRON` | enabled alongside the disabled daily cron — double-fires all 5 daily legs |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `Merge Validations` input indices | shuffled (0,1,2,3,4 out of order) — harmless, confusing |

## Gotchas

- Databricks free tier has **no outbound network** — all fetching stays in n8n.
- **n8n's public API has no execute endpoint.** Webhook / form / chat nodes are the
  only programmatic triggers.
- **USPTO is two-tier:** discovery (search + file list) is free; file bytes are
  capped at **6 per file per 7 days**, and every request counts including 429s.
  Never re-run twice in one day.
- **USPTO zips exceed the 5 GiB upload cap** — the JSONL is what gets uploaded.
- **n8n HTTP node splits JSON arrays into one item per element.** For top-level
  arrays (HF), set `responseFormat: text` and `JSON.parse` in the Code node.
- **`WriteBinaryFile` overwrites.** Date-stamped names give a new file per day.
- **`Merge` (append) waits for all inputs** — never route a leg on a different
  trigger through a shared Merge; the run hangs.
- **Nested double quotes break under `cmd.exe`** in Execute Command nodes, and the
  failure can exit 0. Keep paths unquoted.
- Lakebase: password connections are off by default (project **and** per-compute);
  roles live on the **branch**; role names are case-sensitive (`"Admin"`).
- `.env` is blocked from agent file tools by the Zed `private_files` setting.
