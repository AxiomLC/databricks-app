# Build Spec & Architecture: Multi-Temporal IP & Tech Momentum Engine

## 1. Executive Summary & Layman Terms

This system ingests clean, pre-structured metadata from **three distinct time horizons** (Real-Time Days, Adoption Months, Stealth Brand Years) across **5 Core Technology Pillars** (Graph Databases, Lakehouses, AI Memory, Hybrid RAM, Object Storage).

By avoiding messy HTML contracts, XBRL filings, and 18-month patent publication delays, this pipeline ingests **natively clean API and telemetry feeds** (Trademarks, arXiv papers, PyPI logs, OpenAlex citations, and Hugging Face metrics). The result is a production-grade portfolio showcase demonstrating enterprise pipeline governance, Delta Lake processing, vector search indexing, and interactive UI visualization.

### Plain English Translation of Industry & Databricks Terms

* **Delta Lake / Delta Tables (`deltalake`):** An open-source storage format built on top of Parquet files. Think of it as a standard database table, but with "time travel" (version history) and corporate-grade transactional guarantees, running natively on cheap cloud object storage (like AWS S3 or Cloudflare R2).

* **Bronze** $\rightarrow$ **Silver** $\rightarrow$ **Gold Architecture (Medallion Architecture):**
  * **Bronze:** Raw, untouched API data pulled directly as JSON or Parquet files.
  * **Silver:** Cleaned, deduplicated, and normalized tables mapped to canonical project/company names.
  * **Gold:** Aggregated business metrics, ready for 3D visual graph networks, time-series velocity charts, and AI agent consumption.

* **Unity Catalog:** Databricks' centralized metadata and governance service. It manages data access permissions, volume storage, and audit lineage (tracking exactly which paper or raw dataset produced a given metric).

* **Genie Space:** Databricks' natural-language-to-SQL engine. It lets users ask questions in plain English ("Which graph DB packages surged in downloads this month?") without needing custom, fragile text-to-Cypher translation scripts.

* **Lakebase / pgvector:** Databricks' managed PostgreSQL database equipped with `pgvector`, used to store high-dimensional math representations (vector embeddings) of abstracts and trademark descriptions for semantic similarity search.

* **GraphRAG (Graph Retrieval-Augmented Generation):** Combining traditional vector search with explicit graph connections (nodes and relationships) to ground AI responses in verifiable, cross-referenced tech relationships.

---

## 2. Updated API & Data Source Landscape (2026 Reality Audit)

### Ingestion Constraints & Rules

1. **Databricks Free Edition Limitation:** Outbound network calls from Databricks serverless compute are restricted. **All data fetching happens outside Databricks** (via n8n workflows or Python cron scripts on your local machine/server), which then write clean Parquet/JSON files into Databricks **Unity Catalog Volumes**.

2. **USPTO API Migration:** The legacy *PatentsView API* was decommissioned (March 2026). Trademark ingestion relies on the **USPTO Open Data Portal (ODP)** using an active `X-API-Key` (header authentication).

3. **OpenAlex Databricks Alignment:** OpenAlex runs its entire dataset processing engine on Databricks/Spark. Utilizing OpenAlex for academic citations creates an authentic technical narrative when interviewing with Databricks engineering leads.

---

## 3. Data Source Breakdown Across the 3 Temporal Horizons

| Horizon | Data Source | Frequency | API / Source Route | Primary Key / Join Link |
| :--- | :--- | :--- | :--- | :--- |
| **H1: Real-Time Signals** *(0–7 Days)* | **arXiv API / OAI-PMH** | Daily | `export.arxiv.org/api/query` | `arXiv_ID` |
| | **GitHub REST API** | Daily Snapshot | `api.github.com/repos/{owner}/{repo}` | `repo_name` |
| | **USPTO Trademarks (TSDR)** | Daily / Weekly | ODP `TRTDXFAP` feed (`X-API-Key`) | `serial_number` / `mark_text` |
| **H2: Adoption Signals** *(1–12 Months)* | **Hugging Face Hub API** | Daily Snapshot | `huggingface.co/api/models` | `arxiv_id` / `repo_url` |
| | **PyPI Stats (`pypistats`)** | Daily Snapshot | `pypistats.org/api/packages/` | `package_name` |
| | **OpenAlex API** | Weekly | `api.openalex.org/works` (API Key) | `doi` / `arxiv_id` |
| **H3: Deep Moat / Stealth** *(18+ Months)* | **USPTO Trademarks (Historical)** | Monthly | ODP Historical Bulk Files | `owner_name` / `cpc_class` |

---

## 4. System Architecture & Component Flow

```
+-----------------------------------------------------------------------------------+
|                           YOUR SIDE (n8n / Python Cron)                           |
|  Ingests arXiv, Hugging Face, PyPI, GitHub, OpenAlex, USPTO Trademarks            |
+-----------------------------------------------------------------------------------+
                                          │
                                          │ (Writes Parquet / JSON Files)
                                          ▼
+-----------------------------------------------------------------------------------+
|                             DATABRICKS FREE EDITION                               |
|                                                                                   |
|  [ Unity Catalog Volume ]  ──► Raw Bronze Storage                                 |
|                                         │                                         |
|                                         ▼                                         |
|  [ Serverless Delta Engine ] ──► Silver (MERGE & Dedup) ──► Gold Analytics Tables |
|                                                                                   |
|  [ Lakebase (pgvector) ]   ──► Abstract Embeddings & Semantic Search             |
|  [ Genie Space ]           ──► Natural Language "Ask the Graph" Interface        |
|  [ AppKit (Node + React) ] ──► 3D Interactive Force-Directed Graph UI              |
+-----------------------------------------------------------------------------------+
                                          │
                                          │ (Optional Dual-Export Hook)
                                          ▼
+-----------------------------------------------------------------------------------+
|                        NEO4J / MEMGRAPH / FALKORDB                                |
|  Exports Cypher Graph Structures for Native Graph Queries & Traversal             |
+-----------------------------------------------------------------------------------+
```

---

## 5. Instructions for AI Coding Agents (Cursor / Claude Code / Windsurf)

When building or updating modules in this repo, AI coding agents must adhere strictly to these technical directives:

### A. Core Architecture Guidelines

1. **Separation of Ingestion and Processing:** Never write code that attempts to scrape or fetch third-party public web APIs directly inside Databricks serverless notebook routines. Ingest externally to Unity Catalog Volumes, then trigger processing inside Databricks.

2. **Schema Enforcement & Dedup:**
   * Store node and edge structures in Delta tables using `MERGE` commands to maintain idempotency.
   * Node names must pass through deterministic gates to prune out defined roles or generic text noise before minting graph elements.

3. **Dual-Storage Pattern:**
   * **Tabular metrics & time-series:** Handled by Databricks Delta Lake tables (Gold Layer).
   * **3D Visual Graph Traversal:** Processed via React (`AppKit`) on the frontend, reading unified Node/Edge Delta tables, or piped to Neo4j/Memgraph via batched Cypher `UNWIND` statements.

### B. Python Execution & Egress Sanity Check Script

Run the following script to verify network egress capability on your local environment or runner before executing ingestion tasks:

```python
import requests

targets = {
    "arXiv": "https://export.arxiv.org/api/query?search_query=cat:cs.DB&max_results=1",
    "HuggingFace": "https://huggingface.co/api/models?limit=1",
    "PyPI": "https://pypistats.org/api/packages/neo4j/recent",
    "OpenAlex": "https://api.openalex.org/works?filter=default.search:graph",
    "USPTO_ODP": "https://api.uspto.gov/api/v1/patent/applications/search?limit=1"
}

print("--- Network Access Check ---")
for name, url in targets.items():
    try:
        resp = requests.get(url, timeout=10)
        print(f"[{name}] Status: {resp.status_code}")
    except Exception as e:
        print(f"[{name}] ERROR: {type(e).__name__}")
```

### C. Standard Data Join Patterns

* **Paper $\rightarrow$ Model Edge:** Match Hugging Face model metadata fields (`arxiv_id`) to arXiv IDs.
* **Paper $\rightarrow$ Citation Edge:** Match arXiv DOIs directly with `OpenAlex` work entries.
* **Repo $\rightarrow$ Package Edge:** Parse `setup.py` / `pyproject.toml` repo metadata to map GitHub Repos directly to PyPI Package names.
* **Trademark $\rightarrow$ Company Edge:** Apply canonical name normalization rules (`strip_company_artifacts`) to link filing entities with corporate owner records.

---

## 6. Frontend UI Structure (Databricks AppKit / React)

The UI exposes three core interfaces:

1. **Momentum Board:** Time-series charts comparing download surges (PyPI/Hugging Face), research volume (arXiv), and star velocity (GitHub) across the 5 pillars.
2. **Graph Explorer:** Interactive 3D Force-Directed Graph visualizing multi-source links between Trademarks, Repos, Packages, and Research Papers.
3. **Ask + Lineage (Genie Integration):** Natural language Q&A backed by Databricks Genie, presenting verified step-by-step lineage cards (`Paper` $\rightarrow$ `Repo` $\rightarrow$ `Model` $\rightarrow$ `Trademark`).