-- Canonical Delta table DDL — Unity Catalog
-- Database and volume assumed to pre-exist; adjust catalog/schema names to taste.

CREATE SCHEMA IF NOT EXISTS momentum;

-- ----------------------------------------------------------------------------
-- Silver: deduplicated, normalized graph nodes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS momentum.silver_nodes (
    node_id      STRING NOT NULL,
    kind         STRING NOT NULL,
    name         STRING NOT NULL,
    pillar       STRING,
    source       STRING,
    raw_attrs    MAP<STRING, STRING>,
    ingested_at  TIMESTAMP
)
USING DELTA
PARTITIONED BY (ingested_at);

-- ----------------------------------------------------------------------------
-- Silver: deduplicated graph edges
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS momentum.silver_edges (
    edge_id       STRING NOT NULL,
    edge_type     STRING NOT NULL,
    src_node_id   STRING NOT NULL,
    dst_node_id   STRING NOT NULL,
    weight        DOUBLE,
    source        STRING,
    ingested_at   TIMESTAMP
)
USING DELTA
PARTITIONED BY (ingested_at);

-- ----------------------------------------------------------------------------
-- Gold: aggregated momentum metrics (time-series ready)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS momentum.gold_momentum (
    metric_date   DATE,
    pillar        STRING,
    source        STRING,
    downloads     BIGINT,
    stars         BIGINT,
    citations     BIGINT,
    growth_7d     DOUBLE,
    growth_30d    DOUBLE
)
USING DELTA
PARTITIONED BY (metric_date);
