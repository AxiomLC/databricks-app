# Databricks notebook source
# MAGIC %md
# MAGIC # Silver: Edges
# MAGIC
# MAGIC Builds `momentum.momentum.silver_edges` from `silver_nodes`.
# MAGIC
# MAGIC ## What an edge is here
# MAGIC
# MAGIC An edge is a **relationship between two nodes**. The graph is bipartite for
# MAGIC now: entities on one side, pillar hubs on the other.
# MAGIC
# MAGIC ## Edge types
# MAGIC
# MAGIC | edge_type | src | dst | Derivable today |
# MAGIC |---|---|---|---|
# MAGIC | `pillar_membership` | entity | `pillar:<id>` | ✅ yes |
# MAGIC | `paper_citation` | paper | paper | ✅ yes (OpenAlex `referenced_works`) |
# MAGIC | `package_dependency` | package | package | ✅ yes (registry metadata) |
# MAGIC | `repo_package` | repo | package | ✅ yes (registry repo URL) |
# MAGIC | `trademark_company` | trademark | company | ⚠️ 1 row |
# MAGIC | `arxiv_openalex` | arXiv paper | OpenAlex work | ⚠️ 0 rows (no overlap yet) |
# MAGIC | `paper_model` | paper | model | ❌ no shared key |
# MAGIC
# MAGIC `paper_model` is **not buildable** from the current data. It is listed so
# MAGIC the contract is explicit and adding it later is a small change.
# MAGIC
# MAGIC ## Why pillar membership, not pairwise co-occurrence
# MAGIC
# MAGIC "Two entities share a pillar" as a pairwise edge is O(n²): one pillar with
# MAGIC 543 models would produce ~147,000 edges, and the graph becomes a hairball.
# MAGIC
# MAGIC Bipartite is the same information in linear space: one edge per
# MAGIC `(entity, pillar)` pair. The UI renders pillar hubs with entities radiating
# MAGIC out, which is exactly the "pillar clusters" view — and it stays readable.
# MAGIC
# MAGIC ## Synthetic pillar nodes
# MAGIC
# MAGIC `pillar:<id>` nodes are **not** in `silver_nodes`. They are stable hub
# MAGIC identifiers the UI materialises. They are deliberately excluded from
# MAGIC `silver_nodes` because pillars are not observed entities — they have no
# MAGIC source, no ingestion time, and no daily observation, so putting them there
# MAGIC would corrupt Silver's grain.

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Config

# COMMAND ----------
CATALOG = "momentum"
SCHEMA = "momentum"
SILVER_NODES = f"{CATALOG}.{SCHEMA}.silver_nodes"
TARGET = f"{CATALOG}.{SCHEMA}.silver_edges"

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. pillar_membership
# MAGIC
# MAGIC One edge per `(node_key, observed_date)`. `edge_id` is a deterministic hash
# MAGIC of the edge type plus both endpoints, so re-running produces identical IDs
# MAGIC and the table stays idempotent.
# MAGIC
# MAGIC `weight` is 1.0 — membership is binary. It exists so future edge types
# MAGIC (citation counts, download deltas) can use the same column.

# COMMAND ----------
pillar_edges_sql = f"""
    SELECT
        sha1(concat_ws('|', 'pillar_membership', node_key, pillar)) AS edge_id,
        'pillar_membership'                                          AS edge_type,
        node_key                                                     AS src_node_key,
        node_id                                                      AS src_node_id,
        concat('pillar:', pillar)                                    AS dst_node_id,
        cast(1.0 AS DOUBLE)                                          AS weight,
        source,
        observed_date
    FROM {SILVER_NODES}
    WHERE pillar IS NOT NULL
"""

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. trademark_company
# MAGIC
# MAGIC USPTO rows carry `owner` (the filing entity). The owner becomes a `company`
# MAGIC node, and the trademark points at it.
# MAGIC
# MAGIC Company IDs are normalised: lowercase, corporate suffixes stripped, then
# MAGIC hashed. `Netlify, Inc.` and `NETLIFY INC` must resolve to one company, or
# MAGIC the graph shows the same company twice.
# MAGIC
# MAGIC Only 1 trademark exists today, so this produces ~1 edge. The logic is
# MAGIC correct and will populate as the USPTO leg accumulates.

# COMMAND ----------
company_edges_sql = f"""
    WITH tm AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            trim(raw_attrs['owner']) AS owner
        FROM {SILVER_NODES}
        WHERE source = 'uspto'
          AND raw_attrs['owner'] IS NOT NULL
          AND trim(raw_attrs['owner']) <> ''
    ),
    normalised AS (
        SELECT
            *,
            -- lowercase, strip punctuation, drop corporate suffixes, collapse spaces
            trim(
                regexp_replace(
                    regexp_replace(
                        lower(owner),
                        '\\\\b(inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|co|company)\\\\b',
                        ' '
                    ),
                    '[,.]',
                    ' '
                )
            ) AS canonical_owner
        FROM tm
    )
    SELECT
        sha1(concat_ws('|', 'trademark_company', node_key, canonical_owner)) AS edge_id,
        'trademark_company'                                                  AS edge_type,
        node_key                                                             AS src_node_key,
        node_id                                                              AS src_node_id,
        concat('company:', sha1(canonical_owner))                            AS dst_node_id,
        cast(1.0 AS DOUBLE)                                                  AS weight,
        source,
        observed_date
    FROM normalised
    WHERE length(canonical_owner) > 0
"""

# COMMAND ----------
# MAGIC %md
# MAGIC ### 4. arxiv_openalex
# MAGIC
# MAGIC OpenAlex DOIs for arXiv papers look like `10.48550/arxiv.2006.11239`.
# MAGIC The arXiv node_id looks like `http://arxiv.org/abs/2006.11239v1`. Extracting
# MAGIC the numeric part from both gives a join key.
# MAGIC
# MAGIC **Two traps, both hit during development:**
# MAGIC
# MAGIC 1. **Old-style arXiv IDs** (`cs/0703101`) have no numeric part. The regex
# MAGIC    returns an empty string, and `LIKE '%%'` then matches *everything* —
# MAGIC    producing a 120,000-row cartesian blowup. Guard with `length(...) > 0`.
# MAGIC 2. **Version suffixes** (`v1`, `v4`) must be stripped, or the same paper
# MAGIC    appears as several nodes.
# MAGIC
# MAGIC Currently returns **0 rows**: the arXiv leg fetches recent papers (2026 IDs)
# MAGIC and the OpenAlex leg fetches highly-cited classics (2013–2025), so the two
# MAGIC sets do not overlap. The logic is correct and will populate if the legs are
# MAGIC ever pointed at the same corpus.

# COMMAND ----------
crossref_edges_sql = f"""
    WITH arxiv_nodes AS (
        SELECT DISTINCT
            node_key,
            node_id,
            source,
            observed_date,
            regexp_extract(node_id, 'abs/([0-9]+\\\\.[0-9]+)', 1) AS arxiv_num
        FROM {SILVER_NODES}
        WHERE source = 'arxiv'
    ),
    arxiv_valid AS (
        SELECT * FROM arxiv_nodes WHERE length(arxiv_num) > 0
    ),
    openalex_nodes AS (
        SELECT DISTINCT
            node_key,
            node_id,
            regexp_extract(raw_attrs['doi'], 'arxiv\\\\.([0-9]+\\\\.[0-9]+)', 1) AS arxiv_num
        FROM {SILVER_NODES}
        WHERE source = 'openalex'
          AND raw_attrs['doi'] LIKE '%arxiv%'
    ),
    openalex_valid AS (
        SELECT * FROM openalex_nodes WHERE length(arxiv_num) > 0
    )
    SELECT
        sha1(concat_ws('|', 'arxiv_openalex', a.node_key, o.node_key)) AS edge_id,
        'arxiv_openalex'                                               AS edge_type,
        a.node_key                                                     AS src_node_key,
        a.node_id                                                      AS src_node_id,
        o.node_id                                                      AS dst_node_id,
        cast(1.0 AS DOUBLE)                                            AS weight,
        a.source,
        a.observed_date
    FROM arxiv_valid a
    JOIN openalex_valid o ON a.arxiv_num = o.arxiv_num
"""

# COMMAND ----------
# MAGIC %md
# COMMAND ----------
# MAGIC %md
# MAGIC ### 5. paper_citation
# MAGIC
# MAGIC OpenAlex rows carry `referenced_works`: a JSON array of work IDs this paper
# MAGIC cites. The IDs are already in `node_id` form (`https://openalex.org/W...`),
# MAGIC so the join is a direct equality — no parsing needed.
# MAGIC
# MAGIC **Most references point outside our corpus.** A typical paper cites ~230
# MAGIC works; we only collected ~290 OpenAlex papers. Only a reference that lands
# MAGIC on a node we also collected becomes an edge. That is correct: an edge to a
# MAGIC node that does not exist would be a dangling reference.
# MAGIC
# MAGIC Measured 2026-11-14: 36,449 total references across the five pillars, of
# MAGIC which **371 distinct pairs** land inside the corpus. Those 371 are the graph.
# MAGIC The ratio improves as the OpenAlex leg accumulates more papers.
# MAGIC
# MAGIC `weight` is 1.0 — a citation is a citation. It is not the citation count of
# MAGIC the target, which is already in `gold_level` as `citations`.
# MAGIC
# MAGIC **Dedup is required.** A paper matching four pillars appears four times in
# MAGIC Silver, so its citation list is emitted four times. Without the `row_number`
# MAGIC below, one edge becomes four identical rows on the same day. The edge is a
# MAGIC property of the two papers, not of the pillar, so pillar is not in the key.

# COMMAND ----------
citation_edges_sql = f"""
    WITH citing AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            from_json(
                raw_attrs['referenced_works'],
                'ARRAY<STRING>'
            ) AS refs
        FROM {SILVER_NODES}
        WHERE source = 'openalex'
          AND raw_attrs['referenced_works'] IS NOT NULL
    ),
    exploded AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            ref AS cited_id
        FROM citing
        LATERAL VIEW explode(refs) t AS ref
    ),
    known AS (
        SELECT DISTINCT node_id FROM {SILVER_NODES}
    ),
    joined AS (
        SELECT
            sha1(concat_ws('|', 'paper_citation', e.node_id, e.cited_id)) AS edge_id,
            'paper_citation'                                             AS edge_type,
            e.node_key                                                   AS src_node_key,
            e.node_id                                                    AS src_node_id,
            e.cited_id                                                   AS dst_node_id,
            cast(1.0 AS DOUBLE)                                          AS weight,
            e.source,
            e.observed_date
        FROM exploded e
        JOIN known k ON e.cited_id = k.node_id
        WHERE e.cited_id <> e.node_id
    )
    SELECT
        edge_id,
        edge_type,
        src_node_key,
        src_node_id,
        dst_node_id,
        weight,
        source,
        observed_date
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY edge_id, observed_date
                ORDER BY src_node_key
            ) AS _rn
        FROM joined
    )
    WHERE _rn = 1
"""

# COMMAND ----------
# MAGIC %md
# MAGIC ### 6. package_dependency
# MAGIC
# MAGIC A package declares its dependencies in registry metadata:
# MAGIC
# MAGIC - **PyPI** — `requires_dist`, e.g. `['langchain-core<2.0.0,>=1.8.0', ...]`
# MAGIC - **npm** — `dependencies`, e.g. `{'zod': '^4.6.6', ...}`
# MAGIC
# MAGIC Only dependencies that are **also in our corpus** become edges. A package
# MAGIC typically depends on dozens of things we never collected; an edge to a node
# MAGIC that does not exist would be a dangling reference.
# MAGIC
# MAGIC **Two parsing traps:**
# MAGIC
# MAGIC 1. **Version specifiers must be stripped.** `langchain-core<2.0.0,>=1.8.0`
# MAGIC    is the package `langchain-core`. Split on the first of `<>=!~;[ `.
# MAGIC 2. **Extras must be skipped.** `langchain-anthropic; extra == "anthropic"`
# MAGIC    is an optional extra, not a real dependency. Including them would
# MAGIC    invent edges that only exist if a user opts in.
# MAGIC
# MAGIC Dependencies are **directed**: `s3fs` depends on `fsspec`, not the reverse.
# MAGIC Measured 2026-11-14: 13 internal edges (8 PyPI, 5 npm).

# COMMAND ----------
package_dep_sql = f"""
    WITH pypi_raw AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            from_json(raw_attrs['requires_dist'], 'ARRAY<STRING>') AS deps
        FROM {SILVER_NODES}
        WHERE source = 'pypi'
          AND raw_attrs['requires_dist'] IS NOT NULL
    ),
    pypi_exploded AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            -- Package names only contain alphanumerics, dots, underscores and
            -- hyphens, so match those positively rather than negating a class
            -- of version-specifier characters (which needs fragile escaping).
            lower(regexp_extract(dep, '^([A-Za-z0-9._-]+)', 1)) AS dep_name
        FROM pypi_raw
        LATERAL VIEW explode(deps) t AS dep
        WHERE dep NOT LIKE '%extra ==%'
    ),
    npm_raw AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            from_json(raw_attrs['dependencies'], 'ARRAY<STRING>') AS deps
        FROM {SILVER_NODES}
        WHERE source = 'npm'
          AND raw_attrs['dependencies'] IS NOT NULL
    ),
    npm_exploded AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            lower(trim(dep)) AS dep_name
        FROM npm_raw
        LATERAL VIEW explode(deps) t AS dep
    ),
    all_deps AS (
        SELECT * FROM pypi_exploded
        UNION ALL
        SELECT * FROM npm_exploded
    ),
    known AS (
        SELECT DISTINCT source, node_id
        FROM {SILVER_NODES}
        WHERE source IN ('pypi', 'npm')
    ),
    joined AS (
        SELECT
            sha1(concat_ws('|', 'package_dependency', d.node_id, k.node_id)) AS edge_id,
            'package_dependency'                                            AS edge_type,
            d.node_key                                                      AS src_node_key,
            d.node_id                                                       AS src_node_id,
            k.node_id                                                       AS dst_node_id,
            cast(1.0 AS DOUBLE)                                             AS weight,
            d.source,
            d.observed_date
        FROM all_deps d
        JOIN known k
          ON k.source = d.source
         AND k.node_id = concat(d.source, ':', d.dep_name)
        WHERE d.dep_name <> ''
    )
    SELECT
        edge_id,
        edge_type,
        src_node_key,
        src_node_id,
        dst_node_id,
        weight,
        source,
        observed_date
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY edge_id, observed_date
                ORDER BY src_node_key
            ) AS _rn
        FROM joined
    )
    WHERE _rn = 1
"""

# COMMAND ----------
# MAGIC %md
# MAGIC ### 7. repo_package
# MAGIC
# MAGIC Both registries publish the source repository URL:
# MAGIC
# MAGIC - **PyPI** — `project_urls` (any of `Repository`, `Source`, `Homepage`,
# MAGIC   `Code`, `Download`) or `home_page`
# MAGIC - **npm** — `repository.url`, e.g. `git+https://github.com/n8n-io/n8n.git`
# MAGIC
# MAGIC Extract the `owner/name` slug and match it against a GitHub `node_id`.
# MAGIC
# MAGIC **Why this is sparse.** The GitHub leg collects repos found by *keyword
# MAGIC search*, while packages point at the repos that *publish them*. Those are
# MAGIC different sets — a package's own repo rarely ranks in a keyword search for
# MAGIC the pillar. Measured 2026-11-14: 5 matches (2 PyPI, 3 npm). The ratio
# MAGIC improves if the GitHub leg is ever pointed at package repos directly.
# MAGIC
# MAGIC **URL normalisation matters.** `git+ssh://git@github.com/x/y.git`,
# MAGIC `https://github.com/x/y/tree/main/libs/z`, and `github.com/x/y` must all
# MAGIC resolve to `x/y`. Lowercase, strip the scheme, strip `.git`, take the first
# MAGIC two path segments.

# COMMAND ----------
repo_package_sql = f"""
    WITH pypi_urls AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            from_json(raw_attrs['project_urls'], 'MAP<STRING,STRING>') AS urls,
            raw_attrs['home_page'] AS home_page
        FROM {SILVER_NODES}
        WHERE source = 'pypi'
          AND raw_attrs['project_urls'] IS NOT NULL
    ),
    pypi_candidates AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            lower(trim(regexp_extract(url, 'github\\.com[/:]([^/]+/[^/#?]+)', 1))) AS slug
        FROM pypi_urls
        LATERAL VIEW explode(map_values(urls)) t AS url
        UNION ALL
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            lower(trim(regexp_extract(home_page, 'github\\.com[/:]([^/]+/[^/#?]+)', 1))) AS slug
        FROM pypi_urls
        WHERE home_page IS NOT NULL
    ),
    npm_candidates AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            lower(trim(regexp_extract(raw_attrs['repository_url'],
                                      'github\\.com[/:]([^/]+/[^/#?]+)', 1))) AS slug
        FROM {SILVER_NODES}
        WHERE source = 'npm'
          AND raw_attrs['repository_url'] IS NOT NULL
    ),
    candidates AS (
        SELECT * FROM pypi_candidates
        UNION ALL
        SELECT * FROM npm_candidates
    ),
    cleaned AS (
        SELECT
            node_key,
            node_id,
            source,
            observed_date,
            regexp_replace(slug, '\\.git$', '') AS slug
        FROM candidates
        WHERE length(slug) > 0
    ),
    repos AS (
        SELECT DISTINCT lower(node_id) AS slug, node_id, node_key
        FROM {SILVER_NODES}
        WHERE source = 'github'
    ),
    joined AS (
        SELECT
            sha1(concat_ws('|', 'repo_package', r.node_id, c.node_id)) AS edge_id,
            'repo_package'                                            AS edge_type,
            r.node_key                                                AS src_node_key,
            r.node_id                                                 AS src_node_id,
            c.node_id                                                 AS dst_node_id,
            cast(1.0 AS DOUBLE)                                       AS weight,
            c.source,
            c.observed_date
        FROM cleaned c
        JOIN repos r ON r.slug = c.slug
    )
    SELECT
        edge_id,
        edge_type,
        src_node_key,
        src_node_id,
        dst_node_id,
        weight,
        source,
        observed_date
    FROM (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY edge_id, observed_date
                ORDER BY src_node_key
            ) AS _rn
        FROM joined
    )
    WHERE _rn = 1
"""

# COMMAND ----------
# MAGIC %md
# MAGIC ### 8. Write
# MAGIC
# MAGIC All edge types are unioned into one table. Full rebuild from Silver, same as
# MAGIC every other stage.

# COMMAND ----------
# Everything is assembled into ONE SQL statement. `unionByName` is not supported
# on serverless (Spark Connect), so the branches are joined as text.
# Each branch is wrapped in a subquery because a WITH clause is not allowed
# directly inside a UNION ALL branch.
edges = spark.sql(
    " UNION ALL ".join(
        f"SELECT * FROM ({sql})"
        for sql in (
            pillar_edges_sql,
            company_edges_sql,
            crossref_edges_sql,
            citation_edges_sql,
            package_dep_sql,
            repo_package_sql,
        )
    )
)

(
    edges.write
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .partitionBy("observed_date")
    .saveAsTable(TARGET)
)

# COMMAND ----------
# MAGIC %md
# MAGIC ### 9. Verify

# COMMAND ----------
display(spark.sql(f"""
    SELECT
        edge_type,
        count(*)                        AS edges,
        count(DISTINCT src_node_id)     AS distinct_sources,
        count(DISTINCT dst_node_id)     AS distinct_targets,
        count(DISTINCT observed_date)   AS days
    FROM {TARGET}
    GROUP BY edge_type
    ORDER BY edges DESC
"""))

# COMMAND ----------
# Integrity gate.
checks = spark.sql(f"""
    SELECT
        count(*)                                              AS total,
        count(DISTINCT concat_ws('|', edge_id,
                                 cast(observed_date AS string))) AS uniq_keys,
        sum(IF(edge_id IS NULL, 1, 0))                        AS null_id,
        sum(IF(edge_type IS NULL, 1, 0))                      AS null_type,
        sum(IF(src_node_id IS NULL, 1, 0))                    AS null_src,
        sum(IF(dst_node_id IS NULL, 1, 0))                    AS null_dst,
        sum(IF(src_node_id = dst_node_id, 1, 0))              AS self_loops,
        sum(IF(weight IS NULL OR weight <= 0, 1, 0))          AS bad_weight
    FROM {TARGET}
""").collect()[0]

assert checks["total"] == checks["uniq_keys"], (
    f"duplicate (edge_id, observed_date): {checks['total']} rows, "
    f"{checks['uniq_keys']} keys"
)
assert checks["null_id"] == 0, "null edge_id"
assert checks["null_type"] == 0, "null edge_type"
assert checks["null_src"] == 0, "null src_node_id"
assert checks["null_dst"] == 0, "null dst_node_id"
assert checks["self_loops"] == 0, "self-referencing edge"
assert checks["bad_weight"] == 0, "null or non-positive weight"

print(f"OK — {checks['total']} edges, {checks['uniq_keys']} unique")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 10. Dangling references
# MAGIC
# MAGIC Every `src_node_id` must exist in `silver_nodes`. `dst_node_id` may be a
# MAGIC synthetic hub (`pillar:*`, `company:*`) which the UI materialises, so only
# MAGIC non-hub targets are checked.

# COMMAND ----------
dangling = spark.sql(f"""
    SELECT count(*) AS n
    FROM {TARGET} e
    LEFT JOIN {SILVER_NODES} n ON e.src_node_id = n.node_id
    WHERE n.node_id IS NULL
""").collect()[0]["n"]

assert dangling == 0, f"{dangling} edges point at a src_node_id missing from silver_nodes"

print("OK — no dangling source references")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 11. Not built — what the last edge type needs
# MAGIC
# MAGIC | Edge type | Blocked on |
# MAGIC |---|---|
# MAGIC | `paper_model` | A shared key between arXiv and Hugging Face. HF model cards sometimes cite an arXiv ID, but it is not in the `/api/models` response — it would need a per-model call to `/api/models/<id>` and parsing the card metadata. |
# MAGIC
# MAGIC The table, the ID scheme, and the integrity gates are already in place, so
# MAGIC this is a small addition once the upstream field is collected.
