# Research Directive: Multi-Temporal IP & Data Architecture Intelligence Pipeline

## Objective
Identify, evaluate, and detail public API endpoints, bulk datasets, and data sources to power a **Triple-Horizon Temporal Pipeline** (Days / Months / Years) focused on emerging data infrastructure, high-performance storage, graph databases, and memory architectures.

The downstream system will process these streams into:
1. **Delta Lake / Parquet Tables** for time-series analytics and static UI reporting (charts, velocity metrics, download rates).
2. **Knowledge Graph / GraphRAG Engine** (Neo4j / Memgraph / FalkorDB) enabling AI agents to traverse non-obvious entity relationships across research, trademarks, code repositories, and patent holdings.

---

## 1. Domain & Subject Scope

All candidate data sources must be evaluated based on their coverage of five core technology pillars:

* **Pillar 1: Graph Databases & Query Engines** (Neo4j, Memgraph, FalkorDB/RedisGraph, Apache Age, Cypher, GraphBLAS).
* **Pillar 2: Advanced Table DBs & Lakehouse Formats** (Databricks Delta Lake, Apache Iceberg, Apache Hudi, LanceDB, DuckDB).
* **Pillar 3: AI Memory Layers & State Persistence** (Zep, Letta/MemGPT, Agentic State Machines, Context-Window Caching, Episodic Memory Engines).
* **Pillar 4: High-Speed RAM & Hybrid AI Graph Memory** (In-Memory Graph Compute, Vector-Graph Hybrid Indexes, Hardware-Accelerated KV-Caches, vLLM PagedAttention).
* **Pillar 5: Next-Gen Object Storage & Data Transport** (Cloudflare R2, MinIO, AWS S3 Delta Lake Sync, Apache Arrow / Flight SQL, Parquet Storage Routing).

---

## 2. Architecture Specification: Triple-Horizon Data Pipeline

```
  HORIZON 1: REAL-TIME (0–7 Days)
  [ USPTO Trademarks | ArXiv Preprints | GitHub Trending / Commits ]
                       │
                       ▼
  HORIZON 2: MEDIUM-TERM (1–12 Months)
  [ Hugging Face Model Downloads | PyPI/NPM Logs | OpenAlex Research ]
                       │
                       ▼
  HORIZON 3: HISTORICAL / MOAT (18+ Months)
  [ USPTO Patent Applications | WIPO PCT Feeds | SEC 10-K Technical Disclosures ]
```

---

## 3. Data Source Brainstorming & Candidates to Research

The agent must search for, document, and test open endpoints or public datasets across the following three horizons:

### Horizon 1: Near-Real-Time Signals (0 to 7 Days)
* **USPTO Trademark System (TSDR API / Open Data):**
  * *Target:* Search Class 009 (Software) and Class 042 (Cloud/SaaS) for brand-new filings by enterprise infrastructure companies (e.g., Databricks, Neo4j, Snowflake, Redis, Microsoft).
  * *Research Task:* Locate exact direct API endpoints or bulk daily ZIP extracts for newly filed mark applications.
* **ArXiv RSS / OAI-PMH API:**
  * *Target:* Daily preprint papers under categories `cs.DB` (Databases), `cs.AI` (Artificial Intelligence), and `cs.DC` (Distributed Computing).
  * *Research Task:* Find API syntax for retrieving abstract, author affiliation, linked code repos, and timestamp metadata.
* **GitHub Event Stream (GH Archive / REST API):**
  * *Target:* Real-time star velocity, fork spikes, and commit activities on key graph, memory, and database repositories.

### Horizon 2: Adoption & Momentum Signals (1 to 12 Months)
* **Hugging Face Hub API:**
  * *Target:* Weekly/monthly download counters, likes, and architectural tags for graph-based GNNs, embedding models, and memory-management libraries.
  * *Research Task:* Map out the API parameters to fetch model download trends over structured rolling windows.
* **Package Manager Download Logs (PyPI Stats / Libraries.io):**
  * *Target:* Download metrics for Python libraries (`edgartools`, `pydantic`, `neo4j`, `memgraph`, `lancedb`, `deltalake`, `falkordb`).
* **OpenAlex / Semantic Scholar Graph API:**
  * *Target:* Academic citations, institutional co-author graphs, and corporate R&D lab paper velocity (`@databricks.com`, `@neo4j.com`).

### Horizon 3: Enterprise Deep Moat Signals (18+ Months)
* **USPTO Patent Application Bulk Data (Bulk Data Storage System - BDSS):**
  * *Target:* Published Patent Applications in CPC classifications `G06F 16/00` (Information Retrieval & Database Structures) and `G06N 3/00` (Neural Networks & AI).
  * *Research Task:* Identify links to weekly bulk XML/Parquet files and existing Python parsing wrappers.
* **WIPO Patentscope API / International Applications:**
  * *Target:* Global priority filings for memory hardware, vector caching, and database acceleration.
* **SEC EDGAR XBRL Data Sets:**
  * *Target:* Structured metric extractions from Form 10-K filings tracking technical R&D spending and cloud vendor infrastructure commitments.

---

## 4. The Illuminary Cross-Reference: Dynamic Graph Insights

The primary value proposition of this dataset cross-referencing is uncovering relationships standard tools miss. The search agent should evaluate sources based on their ability to expose the following relationships:

```
[ Trademark Filing: "Project X" ] ──(Correlates To)──> [ ArXiv Preprint Abstract ]
                                                              │
                                                        (Implemented In)
                                                              ▼
[ Enterprise SEC Risk Disclosure ] <──(Adopted By)─── [ GitHub / Hugging Face Repo ]
```

### Key Graph Schema Interconnections to Validate:
1. **The Stealth Product Emergence Vector:**
   `Company (Entity)` $\rightarrow$ *files* $\rightarrow$ `Trademark (0-7 Days)` $\rightarrow$ *shares semantic vectors with* $\rightarrow$ `ArXiv Paper (0-30 Days)` $\rightarrow$ *reveals early product architecture*.
2. **The Open-Source Commercialization Lag:**
   `ArXiv Paper (Concept)` $\rightarrow$ *inspires* $\rightarrow$ `GitHub Repository (Code)` $\rightarrow$ *surges in* $\rightarrow$ `PyPI Downloads` $\rightarrow$ *precedes* $\rightarrow$ `USPTO Patent Application (18 Months Later)`.
3. **The Risk-to-Stack Mapping:**
   `SEC 10-K Infrastructure Disclosure (Enterprise)` $\rightarrow$ *relies on* $\rightarrow$ `Graph DB / Object Storage Technology (Stack)` $\rightarrow$ *matches IP held by* $\rightarrow$ `Vendor Assignee (Neo4j/Databricks/Confluent)`.

---

## 5. UI Requirements & AI Traversal Capabilities

Research how the retrieved fields supports dual UI layers:

* **Layer A: Analytical Dashboard (Time-Series & Bar Charts):**
  * Technology Velocity Matrix (Downloads vs. Citation Growth).
  * Weekly Trademark & Research Paper Volume by Category.
  * Corporate AI Research Rankings.
* **Layer B: Interactive Knowledge Graph (3D Force-Directed / GraphRAG UI):**
  * Visualizing entity links between Companies, Authors, Repositories, Trademarks, and Patents.
  * Enabling LLM Agents to execute Cypher / Vector Hybrid queries (e.g., *"Find all open-source vector-graph projects linked to authors who filed database patents in 2025"*).

---

## 6. Actionable Next Steps for Sub-Agents

1. **API Endpoint Verification:** Return direct, un-authenticated or standard-API-key endpoints for each dataset candidate.
2. **Format Audit:** Specify output formats (JSON, XML, Parquet, TSV) and rate limits for each source.
3. **Python Tooling:** Identify existing Python libraries/SDKs (e.g., `pyuspto`, `arxiv`, `huggingface_hub`, `sec-edgar-downloader`) for immediate pipeline integration.

**ANSWER 11-9-2026**
I'll start with your GitHub to see your existing stack, then verify the key data sources are still live as of today.

Your public repos lean trading and TypeScript/Python, so a data-pipeline project would show range. Now I'll check the data sources, starting with USPTO, which has had big changes.

USPTO has changed a lot: sign-in and API keys are required, and PatentsView's API was shut down in March 2026. Next, arXiv and the research-graph APIs.

OpenAlex's pipeline reportedly runs on Databricks, which would be a strong hook for your application. I'll verify that against their own blog.

OpenAlex confirmed as a Databricks/Spark shop. Now the adoption-signal sources: PyPI, Hugging Face, GH Archive.

Key finding: Hugging Face only gives a rolling 30-day download count, so you'd snapshot it daily, which is a natural Delta use. Now the Databricks side, since that's the audience.

Free Edition looks capable, but I need to check whether outbound internet access is restricted there, since that decides how your ingestion has to work.

Important constraint found: Free Edition blocks most outbound internet. Now Databricks Apps capabilities, since that's your showcase surface.

AppKit (React/Express) and Databricks' own agent-skills repo are directly relevant to your vibe-coding workflow. I'll verify those, plus whether Lakebase supports pgvector.

Next, the Horizon 3 patent route, since PatentsView's API is gone.

Your brief is a 12-source plan, and I'd ship it with 5 sources and one clear story. I don't have separate sub-agents here, so I checked each source and Databricks itself one by one. A few findings change the plan.

## What's changed since the brief was written

- **Databricks Free Edition restricts outbound internet.** Compute is serverless-only, and outbound access is limited to a set of trusted domains. There is no published allowlist. So Databricks probably can't crawl arXiv or Hugging Face itself, and ingestion should happen on your side.
- **The USPTO moved.** The PatentsView API shut down on March 20, 2026, and its data became bulk datasets on the Open Data Portal. The portal now requires a USPTO.gov sign-in, and trademark bulk files need an API key. Keys on profiles missing four newly required fields were deactivated on October 8, 2026, so complete your profile when you register.
- **OpenAlex needs a key now.** Keys have been required since February 13, 2026, and a free key gives about $1 of usage per day.
- **WIPO is out.** Its data products are fee-based, and the free search service prohibits bulk downloading and scraping.

## Source picks

| Tier | Source | Notes |
|---|---|---|
| Build first | **arXiv** (API or OAI-PMH) | Roughly one request per 3 seconds on a single connection; OAI-PMH is the preferred route for bulk metadata. Metadata is CC0. |
| Build first | **Hugging Face Hub API** | No key for public data. `downloads` is a 30-day count, and all-time totals need the `expand` option. There's no history, so you snapshot daily. |
| Build first | **PyPI downloads** (pypistats) | About 5 requests/sec and 30/min, with data 24–48 hours behind. ClickPy also offers a public read-only ClickHouse instance. |
| Build first | **GitHub** | For ~40 watchlist repos, a daily REST snapshot of stars and forks is simplest. Use GH Archive only for one-off star-history backfill. It's keyless hourly files, but around 100–150 MB compressed per hour, so filter as you stream. |
| Build first | **OpenAlex** | Citations, institutions, and co-author links. Use the API for targeted lookups. The full snapshot is free but about 330 GB, so skip it. |
| Phase 2 | **USPTO patents** (ODP bulk) | The PatentsView tables with CPC codes and disambiguated assignees now live on the portal. They currently run through December 31, 2025, so treat them as the historical "moat" layer rather than live data. |
| Phase 2 | **SEC EDGAR** | Keyless. Limited to 10 requests/sec with a declared User-Agent. Pull R&D spend for ~10 companies via the XBRL "frames" endpoints. |
| Stretch | **USPTO trademarks** | The daily applications product is `TRTDXFAP`, with date-named zip files fetched using an `x-api-key` header. |
| Drop | WIPO, Semantic Scholar | WIPO is paid. Semantic Scholar keys start at 1 request/sec, and OpenAlex already covers citations. |

**Edges to prioritise.** Build links with real join keys first. Hugging Face lets you filter by tags, including arXiv IDs, so paper→model is a clean edge. arXiv→OpenAlex works the same way, and GitHub repo→PyPI package is usually in the package metadata. Company→patent assignee and trademark→paper are fuzzy. Add them last and store a confidence score on each edge. The "stealth product" idea is a hypothesis, so present it as one.

## Architecture

```
YOUR SIDE (n8n / Python cron)         DATABRICKS FREE EDITION
arXiv, HF, PyPI, GitHub, OpenAlex  →  Unity Catalog Volume (raw JSON/Parquet)
                                        → Bronze Delta → Silver (MERGE) → Gold
                                                          (metrics, nodes, edges)
                                        → App (AppKit: Express + React)
                                            ├ SQL warehouse: charts
                                            ├ Lakebase: pgvector + app state
                                            └ Genie space: "ask the graph"
```

- **Ingest outside, process inside.** Your n8n and Python skills do the pulling. Databricks does everything after landing.
- **The graph is two Delta tables (`nodes`, `edges`).** Databricks has no native graph database, so traversal runs in SQL and the 3D force-directed view runs in React. Knowing that trade-off is a good interview talking point. A Neo4j or Memgraph export can be an optional bonus later, since that's your home turf.
- **Genie replaces LLM-to-Cypher.** Apps can bind directly to a Genie space, a SQL warehouse, and Volumes. A Genie space over your gold tables is the "ask the graph" feature with very little code.
- **Lakebase handles embeddings.** Databricks has a pgvector template for Lakebase, so abstract-similarity edges can live there.
- **Build it with AppKit.** AppKit is Databricks' Node.js + React SDK, which suits your TypeScript. Databricks also publishes agent skills for Claude Code and Cursor, so your IDE agent gets Databricks-specific guidance.

## What will impress the Databricks group

- **Use Delta's strengths visibly.** Use MERGE for arXiv version updates (the v1/v2 idea from earlier). Use time travel for "as of" views. Since Hugging Face only gives a rolling 30-day number, your daily snapshots are the valuable part.
- **Tell the OpenAlex story.** OpenAlex rebuilt its platform on Apache Spark hosted on Databricks, so your app analyzes data that is itself produced on Databricks.
- **Deploy it properly.** Use a `databricks.yml` bundle, Unity Catalog tables, and a README with the diagram above.
- **Plan around the app limits.** Free Edition allows up to 3 apps, which run for 24 hours after starting or redeploying, and one Lakebase project. Record a 90-second demo video so reviewers see it working even if the app is stopped.
- **Keep it non-commercial.** Free Edition accounts may not be used for commercial purposes, so treat this as a portfolio piece.

## The app: three screens

1. **Momentum Board:** one score per technology pillar, blending GitHub stars/week, PyPI downloads/week, HF downloads, arXiv volume, and citation growth, with a leaderboard.
2. **Graph Explorer:** pick a repo, paper, or org and see its 3D neighborhood.
3. **Ask + Lineage:** Genie chat plus a "paper → repo → model → org" lineage card.

Keep the watchlist to about 40 repos, packages, and orgs across your five pillars, and most rate limits stop mattering.

## Your next 3 steps

1. **Test egress first.** In a new **Databricks notebook cell** (not a terminal), run this:
```python
import requests
for u in ["https://export.arxiv.org/api/query?search_query=cat:cs.DB&max_results=1",
          "https://huggingface.co/api/models?limit=1",
          "https://pypistats.org/api/packages/neo4j/recent"]:
    try:
        print(u.split("/")[2], requests.get(u, timeout=10).status_code)
    except Exception as e:
        print(u.split("/")[2], "BLOCKED", type(e).__name__)
```
If all three print 200, Databricks can ingest directly. If not, use the architecture above.

2. **Get three keys in your browser:** OpenAlex (openalex.org/settings/api), a USPTO Open Data Portal key (data.uspto.gov, with the extra profile fields filled in), and a GitHub personal access token.

3. **Set up your IDE agent.** Install the Databricks CLI and the Databricks agent skills in your IDE. The "Onboard Your Coding Agent" template at developers.databricks.com walks through it, and I'd rather you follow the current page than have me guess commands.

Tell me what the notebook cell printed and I'll lay out the table schemas for bronze, silver, and gold. I can also turn this into a one-page build plan in a doc if you'd like.
