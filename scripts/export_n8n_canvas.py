"""Dump an n8n workflow as plain JSON into n8n/canvas<ISOdate>.json.

Usage:
    python scripts/export_n8n_canvas.py [workflow_id]

Reads N8N_API_URL / N8N_API_KEY from .env. Defaults to the ingestion canvas.
"""

import base64
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

DEFAULT_WORKFLOW = "GQs6702n6vwYjKVa"  # databricks: Ingestion Master (All Legs)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ZED_SETTINGS = os.path.expandvars(r"%APPDATA%\Zed\settings.json")


def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def jwt_audience(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("aud")
    except Exception:
        return None


def public_api_key(env):
    """The public API rejects MCP-scoped tokens, so fall back to the key
    Zed's n8n-mcp server uses (aud=public-api)."""
    key = env.get("N8N_API_KEY", "")
    if jwt_audience(key) == "public-api":
        return key

    with open(ZED_SETTINGS, encoding="utf-8") as fh:
        text = re.sub(r"^\s*//.*$", "", fh.read(), flags=re.M)
    text = re.sub(r",(\s*[}\]])", r"\1", text)  # Zed allows trailing commas
    servers = json.loads(text).get("context_servers", {})
    for cfg in servers.values():
        candidate = (cfg.get("env") or {}).get("N8N_API_KEY")
        if candidate and jwt_audience(candidate) == "public-api":
            return candidate

    raise SystemExit("No public-api scoped n8n key found (.env or Zed settings.json).")


def main():
    workflow_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_WORKFLOW
    env = load_env(os.path.join(ROOT, ".env"))

    base = env["N8N_API_URL"].rstrip("/")
    url = f"{base}/api/v1/workflows/{workflow_id}"
    req = urllib.request.Request(
        url,
        headers={"X-N8N-API-KEY": public_api_key(env), "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    out_dir = os.path.join(ROOT, "n8n")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"canvas{stamp}.json")

    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"wrote {out_path}")
    print(f"  name={data.get('name')} nodes={len(data.get('nodes', []))} active={data.get('active')}")


if __name__ == "__main__":
    main()
