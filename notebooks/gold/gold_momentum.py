# Databricks notebook source
# MAGIC %md
# MAGIC # Gold: Momentum Metrics
# MAGIC
# MAGIC Reads `momentum.momentum.silver_nodes` and produces two tables:
# MAGIC
# MAGIC | Table | Grain | Answers |
# MAGIC |---|---|---|
# MAGIC | `gold_level` | one entity × one day × one metric | "how big is this thing" |
# MAGIC | `gold_volume` | one source × one pillar × one day | "how much appeared" |
# MAGIC
# MAGIC ## Why two tables
# MAGIC
# MAGIC Only five of the seven sources attach a number to an entity (stars,
# MAGIC downloads, citations). arXiv and USPTO carry no such number — their only
# MAGIC signal is *how many records appeared*. Forcing both into one table either
# MAGIC drops two sources or invents a fake metric for them.
# MAGIC
# MAGIC - **Level** = a number attached to a thing. Momentum is the change in it.
# MAGIC - **Volume** = how many things showed up. Momentum is the change in count.
# MAGIC
# MAGIC ## Why long format for level
# MAGIC
# MAGIC One row per metric rather than one column per metric. A star and a download
# MAGIC are not the same unit and must never be summed together; long format makes
# MAGIC that impossible to do by accident, and lets each source contribute only the
# MAGIC metrics it actually has.
# MAGIC
# MAGIC ## The double-count rule
# MAGIC
# MAGIC Silver's grain is `(node_id, pillar, day)`, so a repo matching four pillars
# MAGIC is four rows carrying the **same** star count. `gold_level` keeps the pillar
# MAGIC tag, which means:
# MAGIC
# MAGIC - **Charting one pillar** — correct. That repo contributes its stars once.
# MAGIC - **Summing across all pillars** — double-counts. Use `node_count` from
# MAGIC   `gold_volume`, or dedupe on `node_id` first.
# MAGIC
# MAGIC This is intentional: a repo relevant to four pillars genuinely is evidence
# MAGIC for all four.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Config

# COMMAND ----------
CATALOG = "momentum"
SCHEMA = "momentum"
SILVER = f"{CATALOG}.{SCHEMA}.silver_nodes"
GOLD_LEVEL = f"{CATALOG}.{SCHEMA}.gold_level"
GOLD_VOLUME = f"{CATALOG}.{SCHEMA}.gold_volume"

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Level metrics
# MAGIC
# MAGIC Each entry is `(source, canonical metric name, key in raw_attrs)`.
# MAGIC
# MAGIC Canonical names are chosen so that **identical units share a name**:
# MAGIC `downloads_day` means "downloads in the last day" whether it came from PyPI
# MAGIC or npm. Names that look similar but are not comparable stay distinct —
# MAGIC Hugging Face `downloads` is a cumulative lifetime total, while PyPI
# MAGIC `downloads_day` is a daily rate. Never sum across different metric names.
# MAGIC
# MAGIC **npm is handled separately** (see §3) because its rows carry a `series`
# MAGIC key holding seven days of per-day downloads. That is real daily history,
# MAGIC not a single snapshot, so it is exploded into one row per day.

# COMMAND ----------
METRICS = [
    ("github",      "stars",            "stars"),
    ("github",      "forks",            "forks"),
    ("huggingface", "downloads",        "downloads"),      # cumulative lifetime
    ("huggingface", "likes",            "likes"),
    ("openalex",    "citations",        "cited_by_count"),
    ("pypi",        "downloads_day",    "last_day"),
    ("pypi",        "downloads_week",   "last_week"),
    ("pypi",        "downloads_month",  "last_month"),
]

# Built as one SQL statement rather than a chain of DataFrame unions:
# `unionByName` is not supported on serverless (Spark Connect).
COLS = "node_key, node_id, kind, pillar, source, observed_date"

branches = [
    f"""
    SELECT {COLS}, '{metric}' AS metric_name,
           try_cast(raw_attrs['{key}'] AS DOUBLE) AS metric_value
    FROM {SILVER}
    WHERE source = '{source}'
    """
    for source, metric, key in METRICS
]

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. npm daily series
# MAGIC
# MAGIC npm rows carry `series`: seven days of per-day downloads as a JSON string.
# MAGIC This is the **only true daily history in the dataset** — every other source
# MAGIC gives one snapshot per ingestion run, so its history only exists from the
# MAGIC day Silver started (2026-11-11). npm's series reaches back a week from the
# MAGIC first run, which means npm momentum is computable *now* rather than after
# MAGIC the window fills.
# MAGIC
# MAGIC Two things to get right:
# MAGIC
# MAGIC 1. **`observed_date` is the series day, not the ingestion day.** A row
# MAGIC    ingested on the 14th describing the 9th belongs on the 9th.
# MAGIC 2. **The final day is always 0** — npm's API returns 0 for the current,
# MAGIC    unfinished day. Every row carries `zero_days: 1` confirming it. Those
# MAGIC    rows are dropped, because a zero that means "not measured yet" is not a
# MAGIC    zero that means "nobody downloaded it".
# MAGIC
# MAGIC The same `(node_id, series_day)` can appear in more than one ingestion run
# MAGIC (the 7-day window overlaps day to day). Dedup keeps the newest ingestion,
# MAGIC which is also the most complete measurement of that day.

# COMMAND ----------
# Nested subqueries rather than a CTE: a WITH clause is not allowed inside a
# UNION ALL branch.
npm_series_sql = f"""
    SELECT
        node_key,
        node_id,
        kind,
        pillar,
        source,
        observed_date,
        'downloads_day' AS metric_name,
        cast(metric_value AS DOUBLE) AS metric_value
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY node_key, observed_date
                ORDER BY ingested_at DESC
            ) AS _rn
        FROM (
            SELECT
                node_key,
                node_id,
                kind,
                pillar,
                source,
                ingested_at,
                to_date(s.day)  AS observed_date,
                s.downloads     AS metric_value
            FROM {SILVER}
            LATERAL VIEW explode(
                from_json(raw_attrs['series'],
                          'ARRAY<STRUCT<day: STRING, downloads: BIGINT>>')
            ) t AS s
            WHERE source = 'npm'
        )
        WHERE observed_date IS NOT NULL
    )
    WHERE _rn = 1
      AND metric_value IS NOT NULL
      AND metric_value > 0
"""

# Everything is assembled into ONE SQL statement. `unionByName` is not supported
# on serverless (Spark Connect), so the branches are joined as text.
# A missing or unparseable value is not a zero — drop it rather than let it drag
# an average down.
gold_level = spark.sql(
    "SELECT * FROM ("
    + " UNION ALL ".join(branches + [npm_series_sql])
    + ")\nWHERE metric_value IS NOT NULL"
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 4. Volume metrics
# MAGIC
# MAGIC Every source contributes here, including arXiv and USPTO. `entity_count`
# MAGIC counts rows (one per pillar tag); `node_count` counts distinct things.

# COMMAND ----------
gold_volume = spark.sql(f"""
    SELECT
        source,
        pillar,
        observed_date,
        count(*)                AS entity_count,
        count(DISTINCT node_id) AS node_count
    FROM {SILVER}
    GROUP BY source, pillar, observed_date
""")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 5. Write
# MAGIC
# MAGIC Full rebuild from Silver, same as Silver rebuilds from Bronze. Safe to
# MAGIC re-run; the result depends only on the source data.

# COMMAND ----------
(
    gold_level.write
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("observed_date")
    .saveAsTable(GOLD_LEVEL)
)

(
    gold_volume.write
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("observed_date")
    .saveAsTable(GOLD_VOLUME)
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 6. Verify

# COMMAND ----------
display(spark.sql(f"""
    SELECT
        source,
        metric_name,
        count(*)                AS rows,
        count(DISTINCT node_id) AS entities,
        round(min(metric_value), 2) AS min_value,
        round(max(metric_value), 2) AS max_value
    FROM {GOLD_LEVEL}
    GROUP BY source, metric_name
    ORDER BY source, metric_name
"""))

# COMMAND ----------
display(spark.sql(f"""
    SELECT
        source,
        count(*)                  AS rows,
        sum(entity_count)         AS entities,
        count(DISTINCT pillar)    AS pillars,
        count(DISTINCT observed_date) AS days
    FROM {GOLD_VOLUME}
    GROUP BY source
    ORDER BY entities DESC
"""))

# COMMAND ----------
# Integrity gate.
level_checks = spark.sql(f"""
    SELECT
        count(*)                                        AS total,
        sum(IF(metric_value IS NULL, 1, 0))             AS null_value,
        sum(IF(metric_value < 0, 1, 0))                 AS negative,
        sum(IF(metric_name IS NULL, 1, 0))              AS null_metric,
        count(DISTINCT concat_ws('|', node_key,
                                 cast(observed_date AS string),
                                 metric_name))          AS uniq_keys
    FROM {GOLD_LEVEL}
""").collect()[0]

assert level_checks["total"] == level_checks["uniq_keys"], (
    f"duplicate (node_key, date, metric) in gold_level: "
    f"{level_checks['total']} rows, {level_checks['uniq_keys']} keys"
)
assert level_checks["null_value"] == 0, "null metric_value"
assert level_checks["negative"] == 0, "negative metric_value"
assert level_checks["null_metric"] == 0, "null metric_name"

volume_checks = spark.sql(f"""
    SELECT
        count(*)                            AS total,
        sum(IF(entity_count IS NULL, 1, 0)) AS null_count,
        count(DISTINCT concat_ws('|', source, pillar,
                                 cast(observed_date AS string))) AS uniq_keys
    FROM {GOLD_VOLUME}
""").collect()[0]

assert volume_checks["total"] == volume_checks["uniq_keys"], (
    f"duplicate (source, pillar, date) in gold_volume: "
    f"{volume_checks['total']} rows, {volume_checks['uniq_keys']} keys"
)
assert volume_checks["null_count"] == 0, "null entity_count"

print(
    f"OK — gold_level {level_checks['total']} rows "
    f"({level_checks['uniq_keys']} unique), "
    f"gold_volume {volume_checks['total']} rows"
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 7. Not yet built
# MAGIC
# MAGIC **Growth columns.** `growth_7d` / `growth_30d` need a full window of daily
# MAGIC history. Silver only started accumulating on 11 Nov 2026, so a 7-day delta
# MAGIC is not computable until ~18 Nov and a 30-day delta not until ~11 Dec. Build
# MAGIC the windowed pass once there is enough history — computing it now would
# MAGIC silently produce nulls that look like "no growth".
# MAGIC
# MAGIC **npm `downloads_7d` is no longer produced.** It was a rolling 7-day total
# MAGIC with no per-day breakdown, which cannot show momentum. The exploded `series`
# MAGIC in §3 supersedes it: seven real daily values per package. PyPI's
# MAGIC `downloads_day` does not have npm's incomplete-day problem.
