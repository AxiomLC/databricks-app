# Ingestion layer (runs OUTSIDE Databricks)

Per the build spec §5.A, Databricks serverless free tier has no outbound network egress.
All third-party public API fetching happens here, on your local machine / user-managed runner,
and writes clean Parquet/JSON into a Unity Catalog Volume for Databricks to process.

## Data Source → Horizon Matrix

| Source | Horizon | Frequency | Output file |
|---|---|---|---|
| arXiv | H1 Real-Time | Daily | `arxiv/raw/<date>.parquet` |
| GitHub | H1 Real-Time | Daily snapshot | `github/raw/<date>.parquet` |
| USPTO Trademarks (TSDR) | H1 Real-Time | Daily/Weekly | `uspto/raw/<date>.parquet` |
| Hugging Face | H2 Adoption | Daily snapshot | `huggingface/raw/<date>.parquet` |
| PyPI Stats | H2 Adoption | Daily snapshot | `pypi/raw/<date>.parquet` |
| OpenAlex | H2 Adoption | Weekly | `openalex/raw/<week>.parquet` |
| USPTO Historical | H3 Stealth | Monthly | `uspto_hist/raw/<month>.parquet` |

## Rule

- Write **only** Parquet/JSON here. No Databricks notebooks live in this directory.
- Keep upstream job idempotent: each run produces a date-partitioned snapshot.
