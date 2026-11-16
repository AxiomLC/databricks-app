# HANDOVER

Where we are, what's next. Nothing else — the app itself is documented in
[`techREADME.md`](./techREADME.md) and [`humanREADME.md`](./humanREADME.md).

**Last updated:** 2026-11-16

---

## Where we are

Pipeline is built and verified end to end: n8n → Volume → Silver → Gold → Edges →
UI. The UI renders real data from a snapshot and has been exercised by hand.

The open work is **not** pipeline work. It is UI polish, MCP testing, and query
work.

---

## Pending

| # | Item | Notes |
|---|---|---|
| 1 | **UI tweaks** | General polish pass. Details not yet enumerated. |
| 2 | **"Search nodes…" box** | Build the graph search/filter input for the user. Not started. |
| 3 | **MCP testing** | Exercise the n8n + Databricks MCP servers properly rather than ad-hoc. |
| 4 | **Cypher queries** | Write and test the graph queries. Not started. |

---

## Blocked / deferred

| Item | Why |
|---|---|
| **Databricks App deploy** | UI currently reads a snapshot. Deploying as an AppKit app with live warehouse queries is the next milestone after the above. |
| **Daily cron** | Currently disabled; runs are manual. Re-enable before unattended operation. |
| **`paper_model` edges** | Needs one HF call per model (~543/run). Cost/benefit, not technical. |
| **Growth columns** | Need a full 7-day window; computable from ~2026-11-18. |

---

## Known gaps

- **Approval flow** is wired and the Decline branch routes correctly, but it has
  only been tested with a forced payload — never a genuine leg failure.
- **`Webhook · temp-debug`** is live and unauthenticated, wired to `Pillar Keywords`.
  A `GET` starts a full ingest. Disconnect before going unattended.
- **Test nodes** (`Test`, `Test Error Payload`) are still on the canvas. Remove once
  the error path is signed off.
