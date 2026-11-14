"""Export Gold/Silver tables to a JSON snapshot for the UI.

The UI runs as a Databricks App in production, but during development it reads
this snapshot so the frontend can be built without a live warehouse connection.

Usage:
    python scripts/export_ui_data.py [output_path]

Default output: ui/public/data/snapshot.json
"""
import json
import os
import subprocess
import sys
import urllib.request

WAREHOUSE = "557a444c183dfce2"
HOST = "https://dbc-0a49a6d2-f0ff.cloud.databricks.com"
DEFAULT_OUT = "ui/public/data/snapshot.json"


def token():
    out = subprocess.run(
        ["databricks", "auth", "token", "--output", "json"],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)["access_token"]


def query(sql, tok):
    body = json.dumps({
        "warehouse_id": WAREHOUSE,
        "statement": sql,
        "wait_timeout": "50s",
        "format": "JSON_ARRAY",
    }).encode()
    req = urllib.request.Request(
        f"{HOST}/api/2.0/sql/statements",
        data=body,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.load(r)

    if res.get("status", {}).get("state") != "SUCCEEDED":
        raise RuntimeError(json.dumps(res.get("status"), indent=2))

    schema = (res.get("manifest") or {}).get("schema") or {}
    cols = [c["name"] for c in schema.get("columns", [])]
    rows = res.get("result", {}).get("data_array") or []
    return [dict(zip(cols, row)) for row in rows]


NODES_SQL = """
SELECT
    node_id,
    kind,
    name,
    source,
    concat_ws(',', sort_array(collect_set(pillar))) AS pillars,
    max(observed_date)                              AS last_seen
FROM momentum.momentum.silver_nodes
GROUP BY node_id, kind, name, source
"""

EDGES_SQL = """
SELECT edge_id, edge_type, src_node_id, dst_node_id, weight
FROM momentum.momentum.silver_edges
"""

LATEST_METRICS_SQL = """
SELECT node_id, metric_name, metric_value
FROM (
    SELECT
        node_id,
        metric_name,
        metric_value,
        row_number() OVER (
            PARTITION BY node_id, metric_name
            ORDER BY observed_date DESC
        ) AS rn
    FROM momentum.momentum.gold_level
)
WHERE rn = 1
"""

MOMENTUM_SQL = """
SELECT
    node_id,
    metric_name,
    min_by(metric_value, observed_date) AS first_value,
    max_by(metric_value, observed_date) AS last_value,
    count(DISTINCT observed_date)       AS days
FROM momentum.momentum.gold_level
GROUP BY node_id, metric_name
HAVING count(DISTINCT observed_date) > 1
"""

VOLUME_SQL = """
SELECT source, pillar, observed_date, entity_count, node_count
FROM momentum.momentum.gold_volume
ORDER BY observed_date, source, pillar
"""

SERIES_SQL = """
SELECT node_id, metric_name, observed_date, metric_value
FROM momentum.momentum.gold_level
WHERE metric_name IN ('downloads_day', 'downloads', 'stars', 'citations')
ORDER BY node_id, metric_name, observed_date
"""


def main(out_path=DEFAULT_OUT):
    tok = token()

    print("querying nodes...")
    nodes = query(NODES_SQL, tok)
    print(f"  {len(nodes)} nodes")

    print("querying edges...")
    edges = query(EDGES_SQL, tok)
    print(f"  {len(edges)} edges")

    print("querying latest metrics...")
    latest = query(LATEST_METRICS_SQL, tok)
    print(f"  {len(latest)} metric rows")

    print("querying momentum...")
    momentum = query(MOMENTUM_SQL, tok)
    print(f"  {len(momentum)} momentum rows")

    print("querying volume...")
    volume = query(VOLUME_SQL, tok)
    print(f"  {len(volume)} volume rows")

    print("querying series...")
    series = query(SERIES_SQL, tok)
    print(f"  {len(series)} series points")

    # The REST API returns every value as a string; cast numerics here so the
    # frontend never has to.
    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    # Fold metrics onto nodes.
    by_node = {}
    for row in latest:
        val = num(row["metric_value"])
        if val is not None:
            by_node.setdefault(row["node_id"], {})[row["metric_name"]] = val

    # Momentum: percentage change between first and last observation.
    mom_by_node = {}
    for row in momentum:
        first = num(row["first_value"])
        last = num(row["last_value"])
        if first and first > 0 and last is not None:
            pct = round((last - first) / first * 100, 1)
            prev = mom_by_node.get(row["node_id"])
            # Keep the metric with the largest absolute move as the headline.
            if prev is None or abs(pct) > abs(prev["pct"]):
                mom_by_node[row["node_id"]] = {
                    "pct": pct,
                    "metric": row["metric_name"],
                    "days": row["days"],
                }

    # Series grouped by node.
    series_by_node = {}
    for row in series:
        val = num(row["metric_value"])
        if val is None:
            continue
        series_by_node.setdefault(row["node_id"], []).append({
            "metric": row["metric_name"],
            "date": row["observed_date"],
            "value": val,
        })

    out_nodes = []
    for n in nodes:
        nid = n["node_id"]
        out_nodes.append({
            "id": nid,
            "label": n["name"],
            "kind": n["kind"],
            "source": n["source"],
            "pillars": [p for p in (n["pillars"] or "").split(",") if p],
            "lastSeen": n["last_seen"],
            "metrics": by_node.get(nid, {}),
            "momentum": mom_by_node.get(nid),
            "series": series_by_node.get(nid, []),
        })

    snapshot = {
        "generatedAt": None,
        "nodes": out_nodes,
        "edges": [
            {
                "id": e["edge_id"],
                "type": e["edge_type"],
                "source": e["src_node_id"],
                "target": e["dst_node_id"],
                "weight": e["weight"],
            }
            for e in edges
        ],
        "volume": [
            {
                "source": v["source"],
                "pillar": v["pillar"],
                "date": v["observed_date"],
                "entityCount": num(v["entity_count"]),
                "nodeCount": num(v["node_count"]),
            }
            for v in volume
        ],
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, separators=(",", ":"))

    size = os.path.getsize(out_path)
    print(f"\nwrote {out_path} ({size / 1024:.0f} KB)")
    print(f"  {len(out_nodes)} nodes, {len(snapshot['edges'])} edges, "
          f"{len(snapshot['volume'])} volume rows")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT)
