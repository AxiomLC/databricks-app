# n8n ingestion workflow exports

Scheduled n8n workflows that fetch the public APIs **outside** Databricks and write
date-partitioned Parquet/JSON to a Unity Catalog Volume (local filesystem target
that syncs up, or direct to object storage).

Export each workflow as JSON here (`Workflow > ⋯ > Export`).

| File | Source | Schedule |
|---|---|---|
| `arxiv.daily.json` | arXiv OAI-PMH | Daily |
| `github.daily.json` | GitHub REST | Daily |
| `huggingface.daily.json` | Hugging Face Hub | Daily |
| `pypi.daily.json` | PyPI Stats | Daily |
| `openalex.weekly.json` | OpenAlex | Weekly |
| `uspto.trademarks.json` | USPTO ODP (X-API-Key) | Daily/Weekly |
| `uspto.historical.json` | USPTO ODP bulk | Monthly |
