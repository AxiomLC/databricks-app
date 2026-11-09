# Databricks notebook: Gold — Aggregated momentum metrics
# Databricks notebook source
# MAGIC %md
# MAGIC # Gold: Momentum Aggregates
# MAGIC Roll up Silver node/edge data into `momentum.gold_momentum` for time-series
# MAGIC velocity charts (Momentum Board) and AI/Genie consumption.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Config

# COMMAND ----------
DB = "momentum"

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Aggregate downloads/stars/citations by (date, pillar, source)

# COMMAND ----------
from pyspark.sql import functions as F

silver = spark.read.table(f"{DB}.silver_nodes")

gold = (
    silver.groupBy(
        F.to_date("ingested_at").alias("metric_date"),
        "pillar",
        "source",
    )
    .agg(
        F.sum(F.col("raw_attrs")["downloads"]).alias("downloads"),
        F.sum(F.col("raw_attrs")["stars"]).alias("stars"),
        F.sum(F.col("raw_attrs")["citations"]).alias("citations"),
    )
)

# 7d / 30d growth computed in a follow-up windowed pass (placeholder)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. Upsert into Gold

# COMMAND ----------
( gold.write
  .mode("overwrite")
  .partitionBy("metric_date")
  .saveAsTable(f"{DB}.gold_momentum") )
