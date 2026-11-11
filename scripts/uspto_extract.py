"""Extract pillar-relevant trademarks from a USPTO TDXF daily zip.

The TDXF file is ~55 MB zipped / ~1.08 GB of XML holding every trademark
case with activity that day (~63k cases). We stream it, keep only cases whose
goods/services text matches a pillar term, and emit one JSONL record per hit
in the Bronze envelope defined in techREADME.md §3.1.

Streaming matters: the XML never lands in memory whole, so this runs in
seconds at flat memory instead of needing a Databricks cluster.

Usage:
    python scripts/uspto_extract.py                       # newest zip in data/uspto/raw
    python scripts/uspto_extract.py path/to/tdxf.zip
    python scripts/uspto_extract.py --dry-run             # report, write nothing
    python scripts/uspto_extract.py --no-prune            # keep older zips

Exit codes:
    0  success (JSONL written, or dry-run completed)
    1  bad input (missing zip, missing pillars.json, unreadable XML)
    2  no pillar terms matched (still writes an empty JSONL, but signals loudly)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

try:
    from lxml import etree
except ImportError:  # pragma: no cover
    sys.exit("lxml is required: pip install lxml")

# Reuse the canonical hash so trademark nodes MERGE cleanly in Silver.
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from canonical_names import node_id as canonical_node_id
except ImportError:  # pragma: no cover
    import hashlib

    def canonical_node_id(kind: str, *parts: str) -> str:
        raw = "|".join([kind, *parts])
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW_DIR = ROOT / "data" / "uspto" / "raw"
DEFAULT_PILLARS = ROOT / "pillars.json"

# Goods/services statements carry a type-code beginning GS (e.g. GS0091, GS0421).
# Other statement types (PM = pseudo mark, etc.) are not descriptions.
GS_PREFIX = "GS"

# Filers routinely disclaim adjacent technology to narrow their claim, e.g.
# "... all of the foregoing excluding software for operating data lakehouses".
# A term inside such a clause is an exclusion, not a claim, so skip it.
NEGATION = re.compile(
    r"\b(?:excluding|excludes|except|other than|not including|not for|"
    r"without limitation to|disclaim(?:s|ed|ing)?)\b",
    re.IGNORECASE,
)
# How far back from a match to look for a negation cue.
NEGATION_WINDOW = 120


def build_pattern(term: str) -> re.Pattern[str]:
    """Word-bounded, case-insensitive matcher tolerating a plural last word.

    'graph database' -> \\bgraph\\s+databases?\\b  (matches 'graph databases')
    """
    words = [w for w in re.split(r"\s+", term.strip()) if w]
    if not words:
        raise ValueError("empty term")
    escaped = [re.escape(w) for w in words]
    escaped[-1] += "s?"
    return re.compile(r"\b" + r"\s+".join(escaped) + r"\b", re.IGNORECASE)


def load_pillars(path: Path) -> list[dict]:
    """Read pillars.json as written by the n8n 'Pillar Keywords' chain.

    Accepts either a bare array or a single object wrapping one.
    Each pillar may override the match terms with a 'uspto' array; otherwise
    'keyword' is used.
    """
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found — run the n8n workflow once so the "
            "'Write pillars.json' node creates it"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("pillars", [data])
    if not isinstance(data, list) or not data:
        raise ValueError(f"{path} must contain a non-empty array of pillars")

    pillars = []
    for entry in data:
        name = entry.get("pillar")
        if not name:
            raise ValueError(f"pillar entry missing 'pillar' key: {entry!r}")
        terms = entry.get("uspto") or [entry.get("keyword")]
        terms = [t for t in terms if t]
        if not terms:
            raise ValueError(f"pillar {name!r} has neither 'uspto' nor 'keyword'")
        pillars.append(
            {
                "pillar": name,
                "terms": terms,
                "patterns": [build_pattern(t) for t in terms],
            }
        )
    return pillars


def iter_case_files(xml_stream) -> Iterator[etree._Element]:
    """Yield one <case-file> element at a time, freeing memory as we go."""
    context = etree.iterparse(xml_stream, events=("end",), tag="case-file")
    for _event, element in context:
        yield element
        # Drop the subtree and any preceding siblings so memory stays flat.
        element.clear()
        parent = element.getparent()
        if parent is not None:
            while element.getprevious() is not None:
                del parent[0]


def text_of(element, path: str) -> str:
    found = element.find(path)
    if found is None or found.text is None:
        return ""
    return found.text.strip()


def is_negated(text: str, start: int) -> bool:
    """True if a negation cue sits in the clause immediately before the match."""
    window = text[max(0, start - NEGATION_WINDOW) : start]
    # Only the current clause counts; a cue before a ';' belongs to an earlier claim.
    clause = window.rsplit(";", 1)[-1]
    return bool(NEGATION.search(clause))


def extract_case(case, pillars: list[dict]) -> dict | None:
    """Return a Bronze record if any pillar term hits the goods/services text."""
    statements = []
    for stmt in case.findall(".//case-file-statement"):
        code = text_of(stmt, "type-code")
        if not code.startswith(GS_PREFIX):
            continue
        body = text_of(stmt, "text")
        if body:
            statements.append(body)
    if not statements:
        return None

    goods_services = " ".join(statements)
    matched = []
    for p in pillars:
        for pat in p["patterns"]:
            hit = next(
                (m for m in pat.finditer(goods_services) if not is_negated(goods_services, m.start())),
                None,
            )
            if hit is not None:
                matched.append(p["pillar"])
                break
    if not matched:
        return None

    serial = text_of(case, "serial-number")
    if not serial:
        return None

    owner = case.find(".//case-file-owner")
    classes = [
        text_of(c, "international-code")
        for c in case.findall(".//classification")
    ]
    classes = [c for c in classes if c]

    raw_attrs = {
        "serial": serial,
        "registration": text_of(case, "registration-number"),
        "filing_date": text_of(case, "case-file-header/filing-date"),
        "status_code": text_of(case, "case-file-header/status-code"),
        "status_date": text_of(case, "case-file-header/status-date"),
        "transaction_date": text_of(case, "transaction-date"),
        "attorney": text_of(case, "case-file-header/attorney-name"),
        "nice_classes": ",".join(classes),
        "goods_services": goods_services,
        "matched_pillars": ",".join(matched),
    }
    if owner is not None:
        raw_attrs.update(
            {
                "owner": text_of(owner, "party-name"),
                "owner_type": text_of(owner, "party-type"),
                "owner_legal_entity": text_of(owner, "legal-entity-type-code"),
                "city": text_of(owner, "city"),
                "state": text_of(owner, "state"),
                "country": text_of(owner, "country"),
                "postcode": text_of(owner, "postcode"),
            }
        )

    return {
        "node_id": canonical_node_id("trademark", serial),
        "kind": "trademark",
        "name": text_of(case, "case-file-header/mark-identification"),
        "pillar": matched[0],
        "source": "uspto",
        "raw_attrs": raw_attrs,
        "ingested_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
            "+00:00", "Z"
        ),
    }


def find_xml_member(archive: zipfile.ZipFile) -> str:
    for name in archive.namelist():
        if name.lower().endswith(".xml"):
            return name
    raise ValueError("zip contains no .xml member")


def prune_older_zips(raw_dir: Path, keep: Path) -> list[Path]:
    """Delete every other .zip in raw_dir. The JSONL is the durable artifact."""
    removed = []
    for candidate in sorted(raw_dir.glob("*.zip")):
        if candidate.resolve() == keep.resolve():
            continue
        candidate.unlink()
        removed.append(candidate)
    return removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path", nargs="?", help="TDXF zip (default: newest in raw dir)")
    parser.add_argument("--pillars", default=str(DEFAULT_PILLARS), help="pillars.json path")
    parser.add_argument("--out", help="output JSONL path (default: alongside the zip)")
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    parser.add_argument("--no-prune", action="store_true", help="keep older zips")
    args = parser.parse_args(argv)

    raw_dir = DEFAULT_RAW_DIR
    if args.zip_path:
        # Shells on Windows can leave stray quotes on the argument (e.g. when a
        # path is wrapped in "..." inside an already-quoted command). Strip them.
        cleaned = args.zip_path.strip().strip('"').strip("'")
        zip_path = Path(cleaned).resolve()
    else:
        candidates = sorted(raw_dir.glob("*.zip"))
        if not candidates:
            print(f"error: no .zip found in {raw_dir}", file=sys.stderr)
            return 1
        zip_path = candidates[-1]

    if not zip_path.exists():
        print(f"error: {zip_path} does not exist", file=sys.stderr)
        return 1

    try:
        pillars = load_pillars(Path(args.pillars))
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    out_path = Path(args.out) if args.out else zip_path.with_suffix(".jsonl")

    print(f"zip      : {zip_path.name} ({zip_path.stat().st_size:,} bytes)")
    print(f"pillars  : {', '.join(p['pillar'] for p in pillars)}")
    for p in pillars:
        print(f"           {p['pillar']:<16} terms={p['terms']}")
    print(f"output   : {out_path}")
    print()

    counts = {p["pillar"]: 0 for p in pillars}
    total_cases = 0
    written = 0
    records: list[dict] = []

    try:
        with zipfile.ZipFile(zip_path) as archive:
            member = find_xml_member(archive)
            with archive.open(member) as xml_stream:
                for case in iter_case_files(xml_stream):
                    total_cases += 1
                    record = extract_case(case, pillars)
                    if record is None:
                        continue
                    counts[record["pillar"]] += 1
                    written += 1
                    records.append(record)
    except (zipfile.BadZipFile, etree.XMLSyntaxError, ValueError) as exc:
        print(f"error: could not parse {zip_path.name}: {exc}", file=sys.stderr)
        return 1

    print(f"cases scanned : {total_cases:,}")
    print(f"matches       : {written:,}")
    for pillar, count in counts.items():
        print(f"  {pillar:<16} {count:>5}")

    if args.dry_run:
        print("\n(dry run — nothing written, nothing pruned)")
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"\nwrote {written:,} records -> {out_path}")

    if not args.no_prune:
        removed = prune_older_zips(raw_dir, keep=zip_path)
        if removed:
            print(f"pruned {len(removed)} older zip(s): {', '.join(p.name for p in removed)}")
        else:
            print("no older zips to prune")

    if written == 0:
        print(
            "warning: no pillar terms matched — check the terms in pillars.json",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
