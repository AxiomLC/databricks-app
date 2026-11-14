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
-- Silver: relationships between nodes
-- ----------------------------------------------------------------------------
-- Bipartite for now: entities on one side, pillar hubs on the other.
--
-- GRAIN: (edge_id, observed_date)
--
-- dst_node_id may be a SYNTHETIC hub the UI materialises:
--   pillar:<id>    - a pillar hub, not a row in silver_nodes
--   company:<hash> - a company derived from a USPTO owner name
-- Only src_node_id is guaranteed to exist in silver_nodes.
CREATE TABLE IF NOT EXISTS momentum.silver_edges (
    edge_id        STRING NOT NULL,
    edge_type      STRING NOT NULL,
    src_node_key   STRING NOT NULL,
    src_node_id    STRING NOT NULL,
    dst_node_id    STRING NOT NULL,
    weight         DOUBLE NOT NULL,
    source         STRING NOT NULL,
    observed_date  DATE NOT NULL
)
USING DELTA
PARTITIONED BY (observed_date);

-- ----------------------------------------------------------------------------
-- Gold: per-entity metrics, long format
-- ----------------------------------------------------------------------------
-- One row per entity per day per metric. Long format because a star and a
-- download are different units and must never be summed together.
--
-- GRAIN: (node_key, observed_date, metric_name)
--
-- DOUBLE-COUNT WARNING: Silver tags one entity once per matching pillar, so a
-- repo in 4 pillars appears 4x with the same star count. Charting a single
-- pillar is correct; summing across all pillars double-counts. Use
-- gold_volume.node_count for distinct-entity totals.
CREATE TABLE IF NOT EXISTS momentum.gold_level (
    node_key       STRING NOT NULL,
    node_id        STRING NOT NULL,
    kind           STRING NOT NULL,
    pillar         STRING NOT NULL,
    source         STRING NOT NULL,
    observed_date  DATE NOT NULL,
    metric_name    STRING NOT NULL,
    metric_value   DOUBLE NOT NULL
)
USING DELTA
PARTITIONED BY (observed_date);

-- ----------------------------------------------------------------------------
-- Gold: how many entities appeared, per source/pillar/day
-- ----------------------------------------------------------------------------
-- The only Gold table that includes arXiv and USPTO, which carry no per-entity
-- metric — their signal is purely volume.
--
-- GRAIN: (source, pillar, observed_date)
CREATE TABLE IF NOT EXISTS momentum.gold_volume (
    source         STRING NOT NULL,
    pillar         STRING NOT NULL,
    observed_date  DATE NOT NULL,
    entity_count   BIGINT NOT NULL,
    node_count     BIGINT NOT NULL
)
USING DELTA
PARTITIONED BY (observed_date);
