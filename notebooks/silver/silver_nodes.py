# Databricks notebook source
# MAGIC %md
# MAGIC # Silver: Normalize & Dedup
# MAGIC
# MAGIC Reads the raw JSONL that n8n lands in the Unity Catalog Volume and produces
# MAGIC `momentum.momentum.silver_nodes` — typed, deduped, idempotent on re-run.
# MAGIC
# MAGIC **Input:** `/Volumes/momentum/momentum/landing/<source>/*.jsonl`
# MAGIC (flat per-source dirs — no `raw/` subdir, no parquet).
# MAGIC
# MAGIC ## Grain
# MAGIC
# MAGIC `node_key = sha1(node_id | pillar)`, one row per `(node_key, observed_date)`.
# MAGIC
# MAGIC - **`pillar` is a tag, not an attribute.** A repo matching 4 pillars is 4
# MAGIC   rows. Deduping on `node_id` alone silently drops 3 of 4 tags.
# MAGIC - **`node_id` is registry-qualified upstream** (`npm:minio`, `pypi:minio`),
# MAGIC   so the same package name in two registries is two nodes. `source` is
# MAGIC   therefore redundant in the key.
# MAGIC - **`observed_date` is the partition.** A node seen on 4 days is 4 rows —
# MAGIC   that history is what Gold needs to compute momentum deltas.
# MAGIC
# MAGIC ## Idempotency
# MAGIC
# MAGIC Full recompute from Bronze + `INSERT OVERWRITE`. Bronze is the immutable
# MAGIC archive, so a re-run is always correct and never depends on prior Silver
# MAGIC state.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Config

# COMMAND ----------
LANDING = "/Volumes/momentum/momentum/landing"

# Catalog and schema are BOTH named `momentum`. A two-part name like
# `momentum.silver_nodes` resolves to catalog=momentum, schema=<current>, which
# does not exist — the three-part name is required.
CATALOG = "momentum"
SCHEMA = "momentum"
TARGET = f"{CATALOG}.{SCHEMA}.silver_nodes"

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Read Bronze JSONL
# MAGIC
# MAGIC Glob `*/*.jsonl` rather than `recursiveFileLookup` — the volume also holds
# MAGIC USPTO `.zip` files, which recursive lookup would try to parse as JSON.

# COMMAND ----------
from pyspark.sql import functions as F

raw = (
    spark.read.format("json")
    .load(f"{LANDING}/*/*.jsonl")
    .withColumn("src_file", F.col("_metadata.file_path"))
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. Normalize types
# MAGIC
# MAGIC Three conversions matter:
# MAGIC
# MAGIC - `ingested_at` arrives as an ISO-8601 **string** (Spark's JSON inference
# MAGIC   will not auto-cast it), so it must be parsed explicitly.
# MAGIC - `raw_attrs` arrives as a **struct** whose shape differs per source
# MAGIC   (arxiv has `summary`, npm has `series`, uspto has `attorney`...). The
# MAGIC   schema declares `MAP<STRING,STRING>`, so round-trip through JSON to
# MAGIC   flatten it. Nested values (npm's `series`) become JSON text — acceptable
# MAGIC   for a string map, and Gold parses what it needs.
# MAGIC - **`node_id` is registry-qualified** for packages, and **`pillar` is mapped
# MAGIC   from retired IDs**. See §3.1 and §3.2.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3.1 Registry-qualify package IDs
# MAGIC
# MAGIC Package `node_id`s must carry their registry (`npm:minio` vs `pypi:minio`),
# MAGIC because the same name in two registries is two different packages.
# MAGIC
# MAGIC n8n was fixed to emit the prefix on 2026-11-14, but Bronze still holds files
# MAGIC written before that, with bare names. **Bronze is never rewritten** — it is
# MAGIC the immutable archive — so the correction happens here, on read.
# MAGIC
# MAGIC Why this cannot be skipped:
# MAGIC
# MAGIC - Silver's key is `(node_id, pillar)`. Bare `minio` from npm and bare
# MAGIC   `minio` from PyPI collide and dedup into **one row**, silently losing data.
# MAGIC - Gold's npm series would break in half at the cutover date, because old
# MAGIC   days sit under `minio` and new days under `npm:minio`.
# MAGIC - Edges join on `node_id`; inconsistent IDs would attach them to the wrong
# MAGIC   node.
# MAGIC
# MAGIC The `needs_prefix` count is printed in §6. **Zero is normal.** A jump means
# MAGIC n8n has regressed to bare names again — this is the alarm, not a silent fix.

# COMMAND ----------
PREFIXED_SOURCES = ("npm", "pypi")

needs_prefix = F.col("source").isin(*PREFIXED_SOURCES) & ~F.col("node_id").contains(":")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3.2 Map retired pillar IDs
# MAGIC
# MAGIC The five pillars were renamed on 2026-11-14. Bronze files written before
# MAGIC that date carry the **retired** IDs, and Bronze is never rewritten — so
# MAGIC Silver sees both sets:
# MAGIC
# MAGIC | Retired | Current |
# MAGIC |---|---|
# MAGIC | `graph-db` | `retrieval-engines` |
# MAGIC | `ai-memory` | `temporal-memory` |
# MAGIC | `hybrid-ram` | `retrieval-engines` |
# MAGIC | `object-storage` | `data-persistence` |
# MAGIC | `lakehouse` | `stack-structure` |
# MAGIC
# MAGIC Without this mapping the same entity is tagged with two different pillar
# MAGIC names across the cutover, which splits every per-pillar chart in half and
# MAGIC leaves the retired names with no matching UI definition.
# MAGIC
# MAGIC `hybrid-ram` and `graph-db` both map to `retrieval-engines` — they were
# MAGIC separate pillars that were merged, so an entity tagged with both collapses
# MAGIC to a single tag after mapping (handled by the dedup in §4).
# MAGIC
# MAGIC The `remapped` count is printed in §6. It should fall to zero once all
# MAGIC Bronze files post-date the rename.

# COMMAND ----------
PILLAR_MAP = {
    "graph-db": "retrieval-engines",
    "ai-memory": "temporal-memory",
    "hybrid-ram": "retrieval-engines",
    "object-storage": "data-persistence",
    "lakehouse": "stack-structure",
}

_pillar_map_expr = F.col("pillar")
for old, new in PILLAR_MAP.items():
    _pillar_map_expr = F.when(F.col("pillar") == old, F.lit(new)).otherwise(
        _pillar_map_expr
    )

needs_remap = F.col("pillar").isin(*PILLAR_MAP.keys())

# COMMAND ----------
typed = raw.select(
    F.when(
        needs_prefix,
        F.concat(F.col("source"), F.lit(":"), F.col("node_id")),
    )
    .otherwise(F.col("node_id"))
    .cast("string")
    .alias("node_id"),
    F.col("kind").cast("string").alias("kind"),
    F.col("name").cast("string").alias("name"),
    _pillar_map_expr.cast("string").alias("pillar"),
    F.col("source").cast("string").alias("source"),
    F.from_json(
        F.to_json(F.col("raw_attrs")), "MAP<STRING,STRING>"
    ).alias("raw_attrs"),
    F.to_timestamp(F.col("ingested_at")).alias("ingested_at"),
    F.col("src_file"),
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 4. Key + dedup
# MAGIC
# MAGIC Within a single observation day, latest `ingested_at` wins; `src_file`
# MAGIC breaks ties so the result is deterministic across runs (identical
# MAGIC timestamps are common — one n8n run stamps every row in a leg with the
# MAGIC same value).

# COMMAND ----------
from pyspark.sql.window import Window

keyed = (
    typed.withColumn(
        "node_key",
        F.sha1(F.concat_ws("|", F.col("node_id"), F.col("pillar"))),
    )
    .withColumn("observed_date", F.to_date(F.col("ingested_at")))
)

w = Window.partitionBy("node_key", "observed_date").orderBy(
    F.col("ingested_at").desc(), F.col("src_file").desc()
)

nodes = (
    keyed.withColumn("_rn", F.row_number().over(w))
    .filter(F.col("_rn") == 1)
    .drop("_rn", "src_file")
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 5. Write
# MAGIC
# MAGIC Partitioned by `observed_date` (a DATE), not `ingested_at` (a millisecond
# MAGIC TIMESTAMP). Partitioning on the raw timestamp produced **123 partitions for
# MAGIC 1849 rows** — one per distinct millisecond. Date partitioning gives one
# MAGIC partition per day.

# COMMAND ----------
(
    nodes.write
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("observed_date")
    .saveAsTable(TARGET)
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 6. Verify

# COMMAND ----------
display(spark.sql(f"""
    SELECT
        source,
        count(*)                        AS rows,
        count(DISTINCT node_id)         AS nodes,
        count(DISTINCT pillar)          AS pillars,
        count(DISTINCT observed_date)   AS days,
        min(observed_date)              AS first_seen,
        max(observed_date)              AS last_seen
    FROM {TARGET}
    GROUP BY source
    ORDER BY rows DESC
"""))

# COMMAND ----------
# How many rows needed the registry prefix. Zero is normal — every Bronze file
# was written after the n8n fix. A non-zero count means old files are still
# being read (expected until they age out of the archive, which they never do)
# or that n8n has regressed to bare names.
normalisation_stats = typed.agg(
    F.sum(F.when(needs_prefix, 1).otherwise(0)).alias("needs_prefix"),
    F.sum(F.when(needs_remap, 1).otherwise(0)).alias("remapped"),
    F.count("*").alias("total"),
).collect()[0]

print(
    f"registry prefix applied to {normalisation_stats['needs_prefix']} of "
    f"{normalisation_stats['total']} rows"
)
print(
    f"retired pillar IDs remapped on {normalisation_stats['remapped']} rows"
)

# COMMAND ----------
# Integrity gate: fail loudly rather than let bad rows reach Gold.
checks = spark.sql(f"""
    SELECT
        count(*)                                              AS total,
        count(DISTINCT concat_ws('|', node_key,
                                 cast(observed_date AS string))) AS uniq_keys,
        sum(IF(node_key IS NULL, 1, 0))                       AS null_key,
        sum(IF(ingested_at IS NULL, 1, 0))                    AS null_ts,
        sum(IF(observed_date IS NULL, 1, 0))                  AS null_date,
        sum(IF(kind IS NULL OR name IS NULL
               OR pillar IS NULL OR source IS NULL, 1, 0))    AS null_required
    FROM {TARGET}
""").collect()[0]

assert checks["total"] == checks["uniq_keys"], (
    f"duplicate (node_key, observed_date) in Silver: {checks['total']} rows, "
    f"{checks['uniq_keys']} keys"
)
assert checks["null_key"] == 0, "null node_key"
assert checks["null_ts"] == 0, "unparseable ingested_at"
assert checks["null_date"] == 0, "null observed_date"
assert checks["null_required"] == 0, "null in required column"

# No package may reach Silver with a bare (unqualified) node_id.
bare = spark.sql(f"""
    SELECT count(*) AS n
    FROM {TARGET}
    WHERE source IN ('npm', 'pypi')
      AND node_id NOT LIKE '%:%'
""").collect()[0]["n"]

assert bare == 0, f"{bare} package rows still have an unqualified node_id"

# No retired pillar ID may survive into Silver.
retired = spark.sql(f"""
    SELECT count(*) AS n
    FROM {TARGET}
    WHERE pillar IN ('graph-db', 'ai-memory', 'hybrid-ram',
                     'object-storage', 'lakehouse')
""").collect()[0]["n"]

assert retired == 0, f"{retired} rows still carry a retired pillar ID"

print(f"OK — {checks['total']} rows, {checks['uniq_keys']} unique (node_key, date)")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 7. Cross-registry check
# MAGIC
# MAGIC Package `node_id`s are registry-qualified upstream (`npm:minio` vs
# MAGIC `pypi:minio`), so this should return zero rows. If it ever returns rows,
# MAGIC the n8n minting has regressed to bare names and two different packages are
# MAGIC being conflated.

# COMMAND ----------
display(spark.sql(f"""
    SELECT
        node_id,
        concat_ws(', ', sort_array(collect_set(source))) AS sources,
        count(*) AS rows
    FROM {TARGET}
    GROUP BY node_id
    HAVING count(DISTINCT source) > 1
    ORDER BY rows DESC
"""))
