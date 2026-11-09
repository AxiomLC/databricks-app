"""Canonical name normalization (build spec §5.C).

Mint deterministic, deduplicated node identities before writing to Silver.

- strip_company_artifacts: link trademark filing entities to canonical corporate owners
- node_id: deterministic hash key for idempotent MERGE
"""

import re
import hashlib

# Common corporate suffixes / legal entities to strip when normalizing owner names
COMPANY_ARTIFACTS = (
    r"\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|co|company)\b",
    r"[,.]",
    r"\s+",
)


def strip_company_artifacts(name: str) -> str:
    """Reduce a raw entity name to a canonical form for matching."""
    s = name.lower()
    for pat in COMPANY_ARTIFACTS:
        s = re.sub(pat, " ", s)
    return re.sub(r"\s+", " ", s).strip()


def node_id(kind: str, *parts: str) -> str:
    """Deterministic 16-char hash ID for a graph node/edge (idempotent MERGE key)."""
    raw = "|".join([kind, *parts])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
