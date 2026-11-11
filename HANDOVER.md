# HANDOVER — Current State & Next Steps

Short status for resuming work. Full technical detail: [`techREADME.md`](./techREADME.md).
Plain-language guide: [`humanREADME.md`](./humanREADME.md).

## Where we are

**Phase: TESTING.** Pipeline runs end to end. Remaining: exercise failure paths,
then Silver/Gold, then the UI.

**Repo:** `AxiomLC/databricks-app` (public, GitHub).

**Ingestion (n8n):** `databricks: Ingestion Master (All Legs)` (`GQs6702n6vwYjKVa`),
active, 52 nodes / 4 triggers.

### Flow

```
Cron 05:00 ─┬→ Pillar Keywords ─┬→ arXiv / GitHub / HF / PyPI → Parse → Write → Validate ─┐
            │                   └→ Write Pillars (dangling → pillars.json)                  │
            │                                                                              ├→ Merge → Gate → Route
            └→ USPTO TMs → Find Latest TDXF → USPTO File List → Pick Latest File           │
                         → Download TDXF → Write TDXF → Extract USPTO Gems → Validate ──────┘
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

- 7 legs: arXiv, HF, PyPI, GitHub, OpenAlex, USPTO Trademarks, USPTO Historical
- USPTO hangs off the crons, not `Pillar Keywords` — bulk data has no per-pillar dimension
- `Gate` holds `ALLOW_PARTIAL = false` — any failing leg halts **all** uploads

### Verified

- **Volume** — 36 files confirmed via CLI (`arxiv` 5, `github` 5, `huggingface` 5, `pypi` 21), content read back as valid JSONL.
- **USPTO extraction** — `scripts/uspto_extract.py`: 62,981 cases → 5 matches in 13.5 s.
- **Databricks CLI** — v1.26.0 installed, profile `DEFAULT` valid.
- **Lakebase** — connect + CREATE/INSERT/SELECT/DROP verified.

### Corrections to earlier notes

- Exec `15697` was **not** clean: USPTO returned `[]` (read `products` instead of
  `bulkDataProductBag`) and OpenAlex never ran. The "55 MB" figure came from local
  staging, not that execution.
- `Cron · Daily 05:00` is **disabled**; only `TEMP CRON` fires.

## What's next

1. **Error test with Slack.** Approval branch has never fired. Force a failure and
   confirm Approve/Decline work from mobile, `Expand Approved` rebuilds payloads,
   Decline stops cleanly.
2. **OpenAlex is unreachable from the daily path** — its trigger is disabled and it
   is not in the cron fan-out.
3. **Error flow: don't halt everything on a USPTO failure.** Consider per-leg
   severity so a USPTO failure alerts Slack/UI but still uploads healthy legs.
4. **USPTO annual backfile** — `TRTYRAP` is 177 parts (~10 GB); leg disabled.
5. **Silver/Gold** — `silver_nodes.py` still reads parquet from the wrong path;
   Bronze is JSONL at `/Volumes/momentum/momentum/landing/<source>/`.
6. **UI** — Momentum Board, 3D Graph Explorer, Genie Ask + Lineage.
7. **Optional:** OpenAlex API key ($0.10/day per IP → $1/day).

## Cleanup owed

| Item | Action |
|---|---|
| `Webhook · temp-debug` | testing scaffold — remove when done, then `cleanStaleConnections` |
| `TEMP CRON` | enabled alongside the disabled daily cron — double-fires all 5 daily legs |
| `Write Error to UI` | disabled placeholder, no URL — the HITL/error feed target |
| `Merge Validations` input indices | shuffled (0,1,2,3,4 out of order) — harmless, confusing |

## Gotchas

- Databricks free tier has **no outbound network** — all fetching stays in n8n.
- **n8n's public API has no execute endpoint.** Webhook / form / chat nodes are the
  only programmatic triggers.
- **USPTO is two-tier:** discovery (search + file list) is free; file bytes are
  capped at **6 per file per 7 days**, and every request counts including 429s.
  Never re-run twice in one day.
- **USPTO zips exceed the 5 GiB upload cap** — the JSONL is what gets uploaded.
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
