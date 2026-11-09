# Notebooks — Databricks medallion processing

```
notebooks/
  bronze/   (planned) raw → Silver staged reads
  silver/   MERGE & dedup into momentum.silver_nodes / silver_edges
  gold/     Aggregations into momentum.gold_momentum
```

> Rule (spec §5.A): These notebooks only *process* data already present in
> Unity Catalog Volumes. No third-party network calls from Databricks.
