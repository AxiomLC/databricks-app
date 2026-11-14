# Pillars — Research & Decisions

Working notes behind the five-pillar scheme. **Source of truth for the runtime is
the `Pillar Keywords` node** in workflow `GQs6702n6vwYjKVa`; it writes
`pillars.json` at runtime (gitignored). This file records *why* the pillars look
the way they do.

Status: **locked 2026-11-14**, applied to the pipeline.

---

## 1. The five pillars

Each pillar is a **contest** — two ways of doing the same job. The app measures
which side is gaining share, not which keyword is gaining mentions.

| # | Pillar | id | The contest | UI shape |
|---|---|---|---|---|
| 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` | run the orchestration yourself vs rent it | two-column split, lines crossing |
| 2 | Temporal Memory & Context | `temporal-memory` | evolving state vs flat recall | timeline |
| 3 | Retrieval Strategy | `retrieval-engines` | joins · hops · keyword · vector · columnar | five-way race |
| 4 | Where Durable State Lives | `data-persistence` | local disk vs object store vs managed cloud | stack diagram |
| 5 | Open Format vs Integrated Platform | `stack-structure` | who owns the stack | two poles |

Five different chart types, not five bar charts.

---

## 2. Why the old set was retired

Old: `graph-db`, `lakehouse`, `ai-memory`, `hybrid-ram`, `object-storage`.

| Old pillar | Problem | Resolution |
|---|---|---|
| `hybrid-ram` | Conflated **storage medium** (RAM-resident) with **retrieval method** (vector search). Two different axes in one name. | Split: medium → `data-persistence`, method → `retrieval-engines` |
| `lakehouse` | Overlapped `object-storage` — both claimed table formats and cloud persistence | Merged into `stack-structure` (ownership); storage moved to `data-persistence` |
| `graph-db` | A *category*, not a contest | Absorbed into `retrieval-engines` as one contender among five |
| `ai-memory` | Fine, but named as a category | Renamed `temporal-memory`, framed as evolving-state vs flat-recall |

### The two axes

The old set mixed two orthogonal questions:

| Axis | Question | Contenders |
|---|---|---|
| **Data model** | How is state shaped and queried? | tables · graph · document · inverted index · vector · columnar |
| **Deployment** | Where do the bytes physically live? | RAM · local disk · object store · managed cloud |

Every product is a **coordinate**, not a camp member:

- Neo4j = native graph + local disk
- HydraDB = native graph + object store
- Postgres with edge tables = tables + local disk
- Memgraph = native graph + RAM (WAL/snapshot on disk)

`retrieval-engines` owns the model axis. `data-persistence` owns the deployment
axis. This is what makes "a graph is a database too" stop being a problem.

---

## 3. Two framing decisions

### Vector is a capability, not a camp

Every engine now ships an ANN index — `pgvector`, Elasticsearch vectors, Neo4j
vector indexes, Qdrant filters. So `retrieval-engines` is **not** "graph vs
vector." It is:

> Does the specialist survive, or does one engine absorb everything?

That is the answerable question, and the data can show it.

### Temporal memory is a real contest, not a feature

Big vendors are bolting timestamp columns onto existing stores. HydraDB claims
native temporal handling is faster and cleaner. The pillar measures whether
native temporal products gain share against retrofitted timestamp columns.

---

## 4. Measurement findings (2026-11-14)

Pulled to test whether pillar 1 is observable. It is — on the self-hosted side.

### npm / PyPI, last 30 days

| Package | Registry | Downloads/mo |
|---|---|---|
| `openai` | PyPI | 295,856,631 |
| `@anthropic-ai/sdk` | npm | 236,775,668 |
| `langchain` | PyPI | 156,867,095 |
| `langchain` | npm | 15,013,679 |
| `ollama` | PyPI | 13,275,724 |
| `openclaw` | npm | 11,478,871 |
| `open-webui` | PyPI | 985,348 |
| `n8n` | npm | 535,616 |
| `llama-cpp-python` | PyPI | 519,085 |
| `n8n-nodes-base` | npm | 396,714 |
| `anthropic` | npm | 63,923 |
| `openclaw` | PyPI | 1,624 |
| `hermes` | npm | 1,422 |
| `n8n` | PyPI | 492 |
| `open-webui` | npm | 355 |

### What this says

- **`ollama` / `openai` ≈ 4.5%.** Local model serving is real but small against
  cloud API usage.
- **`openclaw`** ("multi-channel AI gateway with extensible messaging
  integrations") is 11.4M/mo on npm — 20× `n8n`. **Verify before charting:** 275 MB
  unpacked × 11.4M ≈ 3 PB/mo of npm bandwidth. Could be a dependency-of or CI mirror.
- **`hermes` on npm is a different package.** Our Hermes has no npm/PyPI presence —
  GitHub only. Not measurable as a download series.
- **`open-webui` on npm is a stub** (355/mo). Real distribution is Docker + PyPI.
- **`n8n` npm is separable from n8n Cloud** (Cloud does not install the package),
  but includes Docker builds and CI — treat as an index, not a headcount.

### The 2×2

|  | **Cloud model (API)** | **Local model (weights)** |
|---|---|---|
| **Self-hosted app** | openclaw · n8n · Hermes · Continue | Ollama · llama.cpp · LM Studio |
| **SaaS app** | GHL · Monday · Zapier · Copilot | *(nearly empty)* |

The mass is in the top-left. The bottom-right is nearly empty.

> **Emerging thesis:** "local AI" is not winning. **Self-hosted orchestration over
> cloud models** is winning.

That is sharper than either "local LLMs vs subscriptions" or "local apps vs cloud
apps," and it is the one the data supports.

---

## 5. PyPI cohort constraint

The pipeline collects PyPI only — no npm leg. So every package in a pillar's
`pypi` array must be **PyPI-native**.

| Package | PyPI/mo | Verdict |
|---|---|---|
| `n8n` | 492 | ✗ npm package, stub on PyPI |
| `openclaw` | 1,624 | ✗ npm package, stub on PyPI |
| `open-webui` | 985,348 | ✓ real |
| `langchain` | 156,867,095 | ✓ real |

`n8n` and `openclaw` are therefore **excluded** from pillar 1's cohort despite
being the headline self-hosted apps. Adding an npm leg is the fix, not padding
the PyPI list with stubs.

### Packages deliberately dropped

| Package | Pillar | Why |
|---|---|---|
| `boto3` | `data-persistence` | Downloaded by everything; noise floor swamps `obstore` |
| `pyarrow` | `data-persistence` | Same; moved to `stack-structure` where it is on-pillar |
| `letta` | `temporal-memory` | Superseded by `mem0ai` / `graphiti-core` |

---

## 6. Known gaps

### Pillar 1's SaaS side is unmeasured

GHL, Monday and Zapier publish no download counts. Only IDE extensions have
public install numbers (VS Code Marketplace, Open VSX). Options:

1. Publish the SaaS side as a **flat baseline** with the caveat visible in the UI.
2. Narrow the pillar to self-hosted apps vs cloud APIs, using the
   `ollama`/`openai` ratio as the cloud proxy.

**Open question: a separate SaaS data source may be added.** Until then, option 1
with a visible caveat.

### Pillar 3's relational baseline is invisible

Postgres has no repo to star and no growth signal — `psycopg2`/`asyncpg` downloads
are flat noise. The pillar can show graph/vector *gaining*, not tables *losing*.

Mitigation: track `psycopg`, `asyncpg`, `sqlalchemy`, `duckdb` as a **baseline
cohort**, labelled as a reference line rather than a scored contender. `duckdb` is
the interesting one — relational, and actually growing.

### Pillar 4's cloud side is partly blind

Managed cloud storage (S3, R2, GCS) has no download signal. Same treatment as
pillar 1: baseline, caveat visible.

### Snapshotting gates everything

The scoring model below needs trailing history. PyPI Stats retains only **180
days**. Every day without snapshots is history that cannot be recovered.

---

## 7. Scoring model (not yet implemented)

Growth over counts. Per source:

```
growth = ln((current_window + alpha) / (previous_window + alpha))
```

Normalize against a trailing baseline, then combine across **four evidence
families** — not six equally weighted APIs:

| Family | Weight | Source |
|---|---|---|
| Research | 25% | arXiv + OpenAlex (**one** family, deduplicated) |
| Developer activity | 30% | GitHub |
| Package adoption | 35% | PyPI |
| Commercial intent | 10% | USPTO |
| Hugging Face | **0%** in core score | context overlay only |

```
Momentum = 0.25*R + 0.30*G + 0.35*P + 0.10*T
```

Rules:

- Missing families **renormalize**; they never score zero. "No eligible evidence"
  ≠ "evidence of decline."
- Confidence shrinks sparse results toward the midpoint:
  `adjusted = 50 + confidence * (raw - 50)`.
- Breakout requires positive momentum in **≥2** independent families; high
  confidence requires ≥3.

### Three outputs per pillar

- **Momentum** — normalized score across applicable families
- **Coverage** — how many independent families contributed
- **Confidence** — whether samples are large enough and signals agree

### Popularity vs momentum vs winning

- **Popular** — high cumulative stars, downloads, citations
- **Accelerating** — normalized growth above its recent baseline
- **Winning** — gaining share against competitors over multiple windows, with
  corroboration from independent families

Only the third answers the pillar's question.

---

## 8. Open questions

| # | Question |
|---|---|
| 1 | Is `openclaw`'s 11.4M/mo real, or a dependency-of / CI mirror? |
| 2 | Add an npm leg so `n8n` and `openclaw` become measurable? |
| 3 | Add a SaaS data source for pillar 1's right side? |
| 4 | OpenAlex syntax: research recommends scoped `search.title` / `search.title_and_abstract` and calls `filter=title.search:` legacy. Current implementation uses `filter=title.search:"…"`. Verify against the live API. |
| 5 | Start daily snapshots — gates the entire scoring model. |

---

## 9. Reference

- `archive/pillars_research_11_12_2026.md` — external research response
- `archive/pillars.arenas.json` — research's arena definitions
- `archive/arena_query_plan_60.csv` — 60 source-specific queries

> **Note:** the research uses its own ids (`personal-data-plane`,
> `object-first-persistence`, `lakehouse-platforms`). Those are **not** our ids.
> Our pillar 1 (`self-hosted-vs-saas`) is a different contest from the research's
> `personal-data-plane` (local ingestion and on-device runtime). The research
> files are reference material, not source of truth.
