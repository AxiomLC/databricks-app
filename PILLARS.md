# Momentum Engine — repo conventions

## Tech pillars tracked
Graph Databases · Lakehouses · AI Memory · Hybrid RAM · Object Storage

## Data sources
arXiv, GitHub, USPTO ODP, Hugging Face, PyPI Stats, OpenAlex
(3 time horizons: H1 Real-Time / H2 Adoption / H3 Stealth)

## Join rules (spec §5.C)
- **paper → model**: match Hugging Face `arxiv_id` ↔ arXiv ID
- **paper → citation**: match arXiv DOI ↔ OpenAlex work
- **repo → package**: parse `setup.py`/`pyproject.toml` → PyPI name
- **trademark → company**: `strip_company_artifacts` canonical normalization
