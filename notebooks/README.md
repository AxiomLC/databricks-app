# Notebooks — Databricks medallion processing

```
notebooks/
  silver/silver_nodes.py    Bronze JSONL → momentum.momentum.silver_nodes
  silver/silver_edges.py    silver_nodes → momentum.momentum.silver_edges
  gold/gold_momentum.py     silver_nodes → gold_level + gold_volume
```

> **Rule:** these notebooks only *process* data already in the Unity Catalog
> Volume. No third-party network calls from Databricks — Free Edition has no
> outbound network.

Each notebook carries its full rationale in `%md` cells. This file is the index.

## Run order

```
silver_nodes → gold_momentum → silver_edges
```

Gold and Edges both read Silver. All three are **full rebuilds** — safe to re-run,
result depends only on source data.

## `silver_nodes.py`

Reads `landing/<source>/**/*.jsonl`, types it, dedups, writes one row per
`(node_id, pillar, observed_date)`.

| Behaviour | Detail |
|---|---|
| Registry prefix repair | Pre-2026-11-14 Bronze files carry bare names (`minio`). Re-applies `npm:` / `pypi:` on read. Prints the count — zero is normal, a jump means n8n regressed. |
| Retired pillar mapping | `graph-db`, `ai-memory`, `hybrid-ram`, `object-storage`, `lakehouse` map to current IDs. Bronze is never rewritten, so this must stay. |
| Partitioning | `observed_date` — not `ingested_at` (a ms timestamp produced 123 partitions for 1,849 rows). |

## `gold_momentum.py`

Two tables, because they answer different questions:

| Table | Grain | Answers |
|---|---|---|
| `gold_level` | entity × day × metric | how big is this thing |
| `gold_volume` | source × pillar × day | how much appeared |

- **Long format for level** — a star and a download are different units and must
  never be summed. One row per metric makes that impossible by accident.
- **5 of 7 sources carry a metric**; arXiv and USPTO only have *volume*.
- **npm `series` is exploded** into `downloads_day` rows dated by series day, giving
  real history back to 2026-11-08. The final day is dropped — npm returns 0 for the
  day still in progress.
- **`unionByName` is unsupported on serverless** (Spark Connect) — built as one SQL
  string.
- **`growth_7d` / `growth_30d` not built** — need a full window (~2026-11-18 /
  2026-12-11). Building now would emit nulls that look like "no growth".

## `silver_edges.py`

| `edge_type` | src → dst | Rows |
|---|---|---|
| `pillar_membership` | entity → `pillar:<id>` | 2,406 |
| `paper_citation` | paper → paper | 371 |
| `package_dependency` | package → package | 13 |
| `repo_package` | repo → package | 5 |
| `trademark_company` | trademark → company | 1 |
| `arxiv_openalex` | paper → paper | 0 (no corpus overlap) |
| `paper_model` | paper → model | ❌ not buildable |

**Bipartite, not pairwise.** Pairwise pillar co-occurrence is O(n²) — 543 models
would yield ~147k edges for the same information.

**Synthetic hubs.** `pillar:*` and `company:*` are not rows in `silver_nodes` —
pillars are not observed entities, so putting them in Silver would corrupt its grain.

### Parsing traps (all hit during development)

| Trap | Fix |
|---|---|
| Old-style arXiv IDs (`cs/0703101`) have no numeric part — `LIKE '%'` then matches everything, causing a 120k-row cartesian blowup | Guard with `length(...) > 0` |
| arXiv version suffixes (`v1`, `v4`) split one paper into several nodes | Strip before joining |
| Citation edges duplicate 4× for a 4-pillar paper | `row_number` dedup — the edge belongs to the pair, not the pillar |
| PyPI specifiers (`langchain-core<2.0.0,>=1.8.0`) | Split on first of `<>=!~;[ ` |
| PyPI extras (`pkg; extra == "x"`) are optional, not real deps | Skip them |
| Repo URLs vary (`git+ssh://…`, `/tree/main/…`, `.git`) | Lowercase, strip scheme and `.git`, take first two path segments |

### Sparse edge types — expected, not bugs

- **`paper_citation`** — 36,449 references across the corpus, only **371** land
  inside it. A typical paper cites ~230 works; we collected ~290 OpenAlex papers.
- **`repo_package`** — GitHub collects repos by *keyword search*; packages point at
  the repos that *publish* them. Different sets. Improves if GitHub is pointed at
  package repos directly.
- **`arxiv_openalex`** — arXiv fetches recent (2026) papers, OpenAlex fetches
  highly-cited classics (2013–2025). No overlap. Logic is correct.
