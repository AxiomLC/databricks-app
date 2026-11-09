"""Network egress sanity check (build spec §5.B).

Run on your local machine / runner before executing any ingestion task to
confirm the target third-party APIs are reachable.
"""
import requests

targets = {
    "arXiv": "https://export.arxiv.org/api/query?search_query=cat:cs.DB&max_results=1",
    "HuggingFace": "https://huggingface.co/api/models?limit=1",
    "PyPI": "https://pypistats.org/api/packages/neo4j/recent",
    "OpenAlex": "https://api.openalex.org/works?filter=default.search:graph",
    "USPTO_ODP": "https://api.uspto.gov/api/v1/patent/applications/search?limit=1",
}


def main() -> None:
    print("--- Network Access Check ---")
    for name, url in targets.items():
        try:
            resp = requests.get(url, timeout=10)
            print(f"[{name}] Status: {resp.status_code}")
        except Exception as e:  # noqa: BLE001
            print(f"[{name}] ERROR: {type(e).__name__}")


if __name__ == "__main__":
    main()
