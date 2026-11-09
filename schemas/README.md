# Canonical Schema Definitions (Silver / Gold)

These schemas map the diverse raw API payloads into unified node + edge structures
stored as Delta tables. Edge cases and rules per build spec §5.B.

## Unified Graph Nodes

| Field | Type | Source(s) | Notes |
|---|---|---|---|
| node_id | string | derived | deterministic `node_id(kind, ...)` hash — MERGE key |
| kind | string | derived | `paper`, `model`, `package`, `repo`, `company`, `trademark` |
| name | string | varied | canonical display name |
| pillar | string | derived | one of the 5 tech pillars |
| source | string | varied | which upstream API produced this row |
| raw_attrs | map<string,string> | varied | source-specific attributes |
| ingested_at | timestamp | derived | load timestamp (partition) |

## Unified Graph Edges

| Field | Type | Notes |
|---|---|---|
| edge_id | string | MERGE key |
| edge_type | string | `paper_model`, `paper_citation`, `repo_package`, `trademark_company` |
| src_node_id | string | FK → nodes.node_id |
| dst_node_id | string | FK → nodes.node_id |
| weight | double | edge weight (e.g. citation count, download delta) |
| source | string | upstream API |
| ingested_at | timestamp | partition |

## Medallion Stages

- **Bronze:** raw JSON/Parquet from `ingestion/` — kept as-is, partitioned by date/source.
- **Silver:** dedup'd + normalized via `MERGE` on `node_id` / `edge_id` (idempotent).
- **Gold:** aggregated business metrics ready for charts / AI consumption.
