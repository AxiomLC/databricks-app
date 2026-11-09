# Multi-Temporal IP & Tech Momentum Engine

Production-grade portfolio showcase: ingests clean metadata across **3 time horizons** (Real-Time Days, Adoption Months, Stealth Brand Years) spanning **5 Core Technology Pillars** (Graph Databases, Lakehouses, AI Memory, Hybrid RAM, Object Storage).

Pipeline: **Ingest (external) → Bronze → Silver → Gold (Delta Lake) → Vector Search (pgvector) → Genie + 3D Graph UI**

> Full build spec: [`build_readme Databricks.md`](./build_readme%20Databricks.md)

## Architecture at a Glance

```
YOUR SIDE (n8n / Python cron)
  ├─ arXiv, GitHub, USPTO ODP (H1: Real-Time)
  ├─ HuggingFace, PyPI, OpenAlex (H2: Adoption)
  └─ USPTO Historical (H3: Stealth)
          │  writes Parquet/JSON
          ▼
DATABRICKS FREE EDITION
  ├─ Unity Catalog Volume → Bronze (raw)
  ├─ Serverless Delta Engine → Silver (MERGE & dedup) → Gold (analytics)
  ├─ Lakebase (pgvector) → embeddings & semantic search
  ├─ Genie Space → natural-language "Ask the Graph"
  └─ AppKit (Node + React) → 3D force-directed graph UI
          │ (optional dual-export hook)
          ▼
NEO4J / MEMGRAPH / FALKORDB (native graph traversal)
```

## Key Constraints

- **All fetching happens OUTSIDE Databricks** (free tier has no outbound network). External jobs write clean Parquet/JSON to Unity Catalog Volumes; Databricks only *processes*.
- Trademarks use **USPTO ODP** (`X-API-Key` header auth) — legacy PatentsView decommissioned March 2026.
- **OpenAlex** runs its own processing on Databricks/Spark (authentic narrative for Databricks interviews).

## Repository Layout

```
ingestion/       External fetching logic (per data source) — runs outside Databricks
notebooks/       Databricks notebooks: bronze/silver/gold medallion stages
schemas/         Canonical Delta schemas + node/edge definitions
n8n/             n8n workflow JSON exports for scheduled ingestion
ui/              Databricks AppKit (Node + React) frontend
scripts/         Utility scripts (egress check, canonical-name normalization)
```

## Quick Start

```bash
# Verify network egress on your local runner before ingestion
python scripts/egress_check.py
```

See [`docs`](#) for per-source ingestion setup and the medallion processing flow.
