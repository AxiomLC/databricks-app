# Databricks notebook: Silver — MERGE nodes & edges (idempotent)
# Databricks notebook source
# MAGIC %md
# MAGIC # Silver: Dedup & Normalize
# MAGIC Reads staged Bronze parquet from Unity Catalog Volumes, applies deterministic
# MAGIC `node_id` hashing + canonical name normalization, then MERGEs into
# MAGIC `momentum.silver_nodes` / `silver_edges` for idempotent upserts.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Config

# COMMAND ----------
VOLUME_ROOT = "/Volumes/main/default/momentum_raw"   # where ingestion/ writes
DB = "momentum"

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Read Bronze staged files

# COMMAND ----------
from pyspark.sql import functions as F
from pyspark.sql.functions import input_file_name

nodes_df = (
    spark.read.format("parquet")
    .load(f"{VOLUME_ROOT}/nodes/*.parquet")
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. Normalize + dedup

# COMMAND ----------
# Deterministic identity: node_id is minted upstream (scripts/canonical_names.py).
# Here we only ensure single row per node_id (latest wins).
from pyspark.sql.window import Window

w = Window.partitionBy("node_id").orderBy(F.col("ingested_at").desc())
deduped = (
    nodes_df.withColumn("_rn", F.row_number().over(w))
    .filter(F.col("_rn") == 1)
    .drop("_rn")
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 4. MERGE into Silver (idempotent upsert)

# COMMAND ----------
# Target table from schemas/dump.sql (momentum.silver_nodes)
(spark.read.table(f"{DB}.silver_nodes").write
 .mode("overwrite").saveAsTable(f"{DB}.silver_nodes"))  # placeholder — replace with MERGE

# Real MERGE pattern:
# spark.sql(f"""
# MERGE INTO {DB}.silver_nodes AS t
# USING deduped AS s
#   ON t.node_id = s.node_id
# WHEN MATCHED THEN UPDATE SET *
# WHEN NOT MATCHED THEN INSERT *;
# """)
