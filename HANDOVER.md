# HANDOVER — Current State & Next Steps

Short status for resuming work. Full technical detail: [`techREADME.md`](./techREADME.md).
Pillar rationale: [`pillars_research_11_14_2026.md`](./pillars_research_11_14_2026.md).
Plain-language guide: [`humanREADME.md`](./humanREADME.md).

## Where we are

**Phase: INGESTION DONE → SILVER.** All seven legs run and land in Databricks.
Nothing downstream works yet.

**Repo:** `AxiomLC/databricks-app` (public, GitHub).

**Ingestion (n8n):** `databricks: Ingestion Master (All Legs)` (`GQs6702n6vwYjKVa`),
active, 54 nodes / 4 triggers.

### Flow

```
Cron 05:00 ─┬→ Pillar Keywords ─┬→ arXiv / GitHub / HF / PyPI / npm → Parse → Write → Validate ─┐
            │                   └→ Write Pillars (dangling → pillars.json)                        │
            │                                                                                    ├→ Merge → Gate → Route
            └→ USPTO TMs → Find Latest TDXF → File List → Pick Latest → Download → Extract ───────┘
                                                                    → Validate USPTO ─┬→ Databricks
                                                                                      └→ Slack (on error)
                                                                              ┌────────────┴────────────┐
                                                                      0 (clean)│                        │1 (blocked)
                                                                              ▼                        ▼
                                                                      Databricks              Slack · Approve Upload
                                                                      files/uploadFile                 │
                                                                                                       ▼
                                                                                                     If1
                                                                                     approved ──┬── declined
                                                                                                ▼
                                                                                       Expand Approved → Databricks
```

- **7 legs:** arXiv, HF, PyPI, GitHub, npm, OpenAlex, USPTO
- **USPTO bypasses Gate** — unscored discovery feed, uploads directly, errors to Slack
- **OpenAlex** runs weekly via `Read Pillars` → `Pillar Keywords2`
- `Gate` holds `ALLOW_PARTIAL = false` — any failing leg halts all uploads

### Verified 2026-11-14

- **All 7 legs in Databricks** — `arxiv` 5, `github` 5, `huggingface` 5, `pypi` 31,
  `npm` 15, `openalex` 5, `uspto` 1. Local and remote counts match.
- **npm leg** — bulk range queries (128 pkg/request) for unscoped, one call each for
  scoped. 15 requests → 5. Run `15759` clean, 61 items through Gate.
- **USPTO** — `apc261113.jsonl` uploaded. 2–5 matches/day, high signal.
- **Rate limits** — npm: batch 1 / 2500 ms / 3 retries. PyPI: batch 1 / 500 ms / 1 retry.

## The five pillars (locked 2026-11-14)

| # | Pillar | id |
|---|---|---|
| 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` |
| 2 | Temporal Memory & Context | `temporal-memory` |
| 3 | Retrieval Strategy | `retrieval-engines` |
| 4 | Where Durable State Lives | `data-persistence` |
| 5 | Open Format vs Integrated Platform | `stack-structure` |

Source of truth is the `Pillar Keywords` node — it writes `pillars.json` at runtime
(gitignored). **Never edit `pillars.json`.**

## What's next

1. **Silver** — `silver_nodes.py` still reads parquet; Bronze is JSONL at
   `/Volumes/momentum/momentum/landing/<source>/`. This blocks everything downstream.
2. **Gold + momentum scoring** — needs snapshot history, which starts accumulating
   from today. PyPI backfills 180 days via `pypistats /overall`; npm backfills to 2015.
3. **UI** — Momentum Board, 3D Graph Explorer, Genie Ask + Lineage.
4. **Error test with Slack** — approval branch has never fired. Force a failure,
   confirm Approve/Decline work from mobile.

## Cleanup owed

| Item | Action |
|---|---|
| `Webhook · temp-debug` | testing scaffold — remove when done, then `cleanStaleConnections` |
| `TEMP CRON` | enabled alongside the disabled daily cron — double-fires all legs |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `READ ME` sticky note | still lists old pillar ids and the 55 MB figure |
| `Merge Validations` input indices | shuffled (0,1,2,3,4 out of order) — harmless, confusing |

## Gotchas

- **n8n draft vs published.** Executions run the *published* version; the editor loads
  the *draft*. After MCP edits, **publish** or the editor shows stale content. An open
  editor tab can autosave stale state over your changes.
- **Databricks node needs binary data.** Every validator must attach the file as
  binary, not just report on it. Filenames come from the validator's `file` field.
- **Scoped npm names contain `@` and `/`.** Both `Write npm JSONL` and `Validate npm`
  must sanitize identically, or Databricks creates nested directories.
- **Databricks free tier has no outbound network** — all fetching stays in n8n.
- **n8n's public API has no execute endpoint.** Webhook / form / chat nodes are the
  only programmatic triggers.
- **USPTO is two-tier:** discovery is free; file bytes are capped at **6 per file per
  7 days**, and every request counts including 429s. One request per day is safe.
- **USPTO zips exceed the 5 GiB upload cap** — the extracted JSONL is what uploads.
- **n8n HTTP node splits JSON arrays into one item per element.** For top-level
  arrays (HF), set `responseFormat: text` and `JSON.parse` in the Code node.
- **`WriteBinaryFile` overwrites.** Date-stamped names give a new file per day.
- **`Merge` (append) waits for all inputs** — never route a leg on a different
  trigger through a shared Merge; the run hangs.
- **Nested double quotes break under `cmd.exe`** in Execute Command nodes, and the
  failure can exit 0. Keep paths unquoted.
- Lakebase: password connections are off by default (project **and** per-compute);
  roles live on the **branch**; role names are case-sensitive (`"Admin"`).
- `.env` is blocked from agent file tools by the Zed `private_files` setting.
