# Canonical Schema Definitions (Silver / Gold)

These schemas map the diverse raw API payloads into unified node + edge structures
stored as Delta tables. Edge cases and rules per build spec §5.B.

## Unified Graph Nodes

| Field | Type | Source(s) | Notes |
|---|---|---|---|
| node_id | string | derived | registry-qualified for packages (`npm:minio` vs `pypi:minio`). Silver re-applies the prefix on read for pre-2026-11-14 Bronze files |
| kind | string | derived | `paper`, `model`, `package`, `repo`, `company`, `trademark` |
| name | string | varied | canonical display name |
| pillar | string | derived | one of the 5 tech pillars |
| source | string | varied | which upstream API produced this row |
| raw_attrs | map<string,string> | varied | source-specific attributes |
| ingested_at | timestamp | derived | load timestamp (partition) |

## Unified Graph Edges

| Field | Type | Notes |
|---|---|---|
| edge_id | string | sha1 of edge_type + both endpoints — deterministic, so re-runs are idempotent |
| edge_type | string | see table below |
| src_node_key | string | FK → silver_nodes.node_key |
| src_node_id | string | FK → silver_nodes.node_id (always a real node) |
| dst_node_id | string | real node **or** synthetic hub (`pillar:*`, `company:*`) |
| weight | double | 1.0 for membership; reserved for citation counts / download deltas |
| source | string | upstream API |
| observed_date | date | partition |

### Edge types

| edge_type | src → dst | Status |
|---|---|---|
| `pillar_membership` | entity → `pillar:<id>` | ✅ built (2,432) |
| `paper_citation` | paper → paper | ✅ built (371) |
| `package_dependency` | package → package | ✅ built (13) |
| `repo_package` | repo → package | ✅ built (5) |
| `trademark_company` | trademark → `company:<hash>` | ✅ built (1) |
| `arxiv_openalex` | arXiv paper → OpenAlex work | ✅ built (0 — no corpus overlap) |
| `paper_model` | paper → model | ❌ needs per-model HF call — arXiv ID lives in `cardData`, not the list response. ~543 requests/run, est. 10–20% hit rate. See `techREADME.md` §3.4 |

### package_dependency

Registry metadata: PyPI `requires_dist`, npm `dependencies`. Only dependencies
also in our corpus become edges — a package depends on dozens of things we never
collected, and an edge to a missing node would dangle.

⚠️ **Strip version specifiers.** `langchain-core<2.0.0,>=1.8.0` is the package
`langchain-core`. Match `^([A-Za-z0-9._-]+)` — a positive class, because negating
version-specifier characters needs fragile escaping that Databricks rejects.

⚠️ **Skip extras.** `langchain-anthropic; extra == "anthropic"` is optional, not
a real dependency. Including them invents edges that only exist on opt-in.

### repo_package

Both registries publish a source repo URL (PyPI `project_urls` / `home_page`,
npm `repository.url`). Extract the `owner/name` slug and match a GitHub `node_id`.

⚠️ **Sparse by design.** The GitHub leg collects repos found by *keyword search*;
packages point at the repos that *publish them*. Different sets. Measured
2026-11-14: 5 matches. Improves if the GitHub leg targets package repos directly.

⚠️ **URL normalisation.** `git+ssh://git@github.com/x/y.git`,
`https://github.com/x/y/tree/main/libs/z`, and `github.com/x/y` must all resolve
to `x/y`: lowercase, strip scheme, strip `.git`, take two path segments.

### paper_citation

OpenAlex rows carry `referenced_works` — a JSON array of cited work IDs, already in
`node_id` form. Only references landing on a node we also collected become edges;
the rest point outside the corpus and would be dangling.

Measured 2026-11-14: 36,449 total references across five pillars, **371 distinct
pairs** inside the corpus. The ratio improves as the OpenAlex leg accumulates.

⚠️ **Dedup is required.** A paper matching four pillars appears four times in
Silver, so its citation list is emitted four times. Dedup on
`(edge_id, observed_date)` — the edge is a property of the two papers, not the
pillar.

### Why bipartite, not pairwise

"Two entities share a pillar" as a pairwise edge is O(n²) — one pillar with 543
models yields ~147,000 edges and an unreadable hairball. Bipartite encodes the
same information in linear space: one edge per `(entity, pillar)`. The UI renders
pillar hubs with entities radiating out, which is the clusters view.

### Synthetic hubs

`pillar:*` and `company:*` nodes are **not** in `silver_nodes`. Pillars are not
observed entities — no source, no ingestion time, no daily observation — so
putting them in Silver would corrupt its grain. The UI materialises them.

## Gold: Level Metrics

One row per entity per day per metric. **Long format** — a star and a download
are different units and must never be summed together.

| Field | Type | Notes |
|---|---|---|
| node_key | string | FK → silver_nodes.node_key |
| node_id | string | registry-qualified entity id |
| kind | string | `paper`, `model`, `package`, `repo`, `trademark` |
| pillar | string | one of the 5 pillars |
| source | string | upstream API |
| observed_date | date | partition |
| metric_name | string | see table below |
| metric_value | double | never negative |

### Metric names

Names are canonical so identical units share a name across sources.

| metric_name | Sources | Meaning |
|---|---|---|
| `stars` | github | cumulative stars |
| `forks` | github | cumulative forks |
| `downloads` | huggingface | **cumulative lifetime** downloads |
| `likes` | huggingface | cumulative likes |
| `citations` | openalex | cumulative citations |
| `downloads_day` | pypi, npm | downloads on that specific day |
| `downloads_week` | pypi | downloads in the last week |
| `downloads_month` | pypi | downloads in the last month |

⚠️ **npm `downloads_day` is real daily history.** npm rows carry a `series` key
with 7 days of per-day downloads, exploded into one row per day. `observed_date`
is the **series day**, not the ingestion day — so npm history reaches back to
2026-11-08, a week before Silver started. This is the only source with true daily
history; every other source has one snapshot per run.

⚠️ **npm's final day is dropped.** npm returns 0 for the current unfinished day
(`zero_days: 1`). Those rows are excluded, because "not measured yet" is not
"nobody downloaded it".

⚠️ **npm `downloads_7d` was removed.** It was a rolling total with no per-day
breakdown, so it could not show momentum. The exploded series supersedes it.

⚠️ **Never sum across `metric_name`.** `downloads` (lifetime) and
`downloads_day` (daily rate) are not comparable.

## Gold: Volume Metrics

How many entities appeared, per source/pillar/day. The only Gold table that
includes **arXiv** and **USPTO**, which carry no per-entity metric.

| Field | Type | Notes |
|---|---|---|
| source | string | upstream API |
| pillar | string | one of the 5 pillars |
| observed_date | date | partition |
| entity_count | bigint | rows (one per pillar tag) |
| node_count | bigint | distinct entities |

## Medallion Stages

- **Bronze:** raw JSONL from n8n at `/Volumes/momentum/momentum/landing/<source>/` — kept as-is, never edited.
- **Silver:** typed, deduped, one row per `(node_id, pillar, observed_date)`. Rebuilt from Bronze on every run.
- **Gold:** `gold_level` (per-entity metrics) + `gold_volume` (entity counts). Rebuilt from Silver on every run.

All three stages are full rebuilds, not incremental merges — Bronze is the
immutable archive, so a re-run is always correct.
