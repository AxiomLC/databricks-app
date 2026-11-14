# Pillars — Research & Decisions

Working notes behind the five-pillar scheme. **Source of truth for the runtime is
the `Pillar Keywords` node** in workflow `GQs6702n6vwYjKVa`; it writes
`pillars.json` at runtime (gitignored). This file records *why* the pillars look
the way they do.

Status: **pillars locked 2026-11-14.** Source-coverage audit received and
verified the same day — see §6–7. Pillars unchanged by the audit.

---

## 1. The five pillars

Each pillar is a **contest** — two ways of doing the same job. The app measures
which side is gaining share, not which keyword is gaining mentions.

| # | Pillar | id | The contest | UI shape |
|---|---|---|---|---|
| 1 | Self-hosted AI Apps vs SaaS AI Apps | `self-hosted-vs-saas` | run the orchestration yourself vs rent it | two-column split, lines crossing |
| 2 | Temporal Memory & Context | `temporal-memory` | evolving state vs flat recall | timeline |
| 3 | Retrieval Strategy | `retrieval-engines` | joins · hops · keyword · vector · columnar | five-way race |
| 4 | Where Durable State Lives | `data-persistence` | local disk vs object store vs managed cloud | stack diagram |
| 5 | Open Format vs Integrated Platform | `stack-structure` | who owns the stack | two poles |

Five different chart types, not five bar charts.

---

## 2. Why the old set was retired

Old: `graph-db`, `lakehouse`, `ai-memory`, `hybrid-ram`, `object-storage`.

| Old pillar | Problem | Resolution |
|---|---|---|
| `hybrid-ram` | Conflated **storage medium** (RAM-resident) with **retrieval method** (vector search). Two different axes in one name. | Split: medium → `data-persistence`, method → `retrieval-engines` |
| `lakehouse` | Overlapped `object-storage` — both claimed table formats and cloud persistence | Merged into `stack-structure` (ownership); storage moved to `data-persistence` |
| `graph-db` | A *category*, not a contest | Absorbed into `retrieval-engines` as one contender among five |
| `ai-memory` | Fine, but named as a category | Renamed `temporal-memory`, framed as evolving-state vs flat-recall |

### The two axes

The old set mixed two orthogonal questions:

| Axis | Question | Contenders |
|---|---|---|
| **Data model** | How is state shaped and queried? | tables · graph · document · inverted index · vector · columnar |
| **Deployment** | Where do the bytes physically live? | RAM · local disk · object store · managed cloud |

Every product is a **coordinate**, not a camp member:

- Neo4j = native graph + local disk
- HydraDB = native graph + object store
- Postgres with edge tables = tables + local disk
- Memgraph = native graph + RAM (WAL/snapshot on disk)

`retrieval-engines` owns the model axis. `data-persistence` owns the deployment
axis. This is what makes "a graph is a database too" stop being a problem.

---

## 3. Two framing decisions

### Vector is a capability, not a camp

Every engine now ships an ANN index — `pgvector`, Elasticsearch vectors, Neo4j
vector indexes, Qdrant filters. So `retrieval-engines` is **not** "graph vs
vector." It is:

> Does the specialist survive, or does one engine absorb everything?

That is the answerable question, and the data can show it.

### Temporal memory is a real contest, not a feature

Big vendors are bolting timestamp columns onto existing stores. HydraDB claims
native temporal handling is faster and cleaner. The pillar measures whether
native temporal products gain share against retrofitted timestamp columns.

---

## 4. Measurement findings (2026-11-14)

Pulled to test whether pillar 1 is observable. It is — on the self-hosted side.

### npm / PyPI, last 30 days

| Package | Registry | Downloads/mo |
|---|---|---|
| `openai` | PyPI | 295,856,631 |
| `@anthropic-ai/sdk` | npm | 236,775,668 |
| `langchain` | PyPI | 156,867,095 |
| `langchain` | npm | 15,013,679 |
| `ollama` | PyPI | 13,275,724 |
| `openclaw` | npm | 11,478,871 |
| `open-webui` | PyPI | 985,348 |
| `n8n` | npm | 535,616 |
| `llama-cpp-python` | PyPI | 519,085 |
| `n8n-nodes-base` | npm | 396,714 |
| `anthropic` | npm | 63,923 |
| `openclaw` | PyPI | 1,624 |
| `hermes` | npm | 1,422 |
| `n8n` | PyPI | 492 |
| `open-webui` | npm | 355 |

### What this says

- **`ollama` / `openai` ≈ 4.5%.** Local model serving is real but small against
  cloud API usage.
- **`openclaw`** ("multi-channel AI gateway with extensible messaging
  integrations") is 11.4M/mo on npm — 20× `n8n`. **Still unverified** whether this
  is a dependency-of or CI mirror; 275 MB unpacked × 11.4M ≈ 3 PB/mo of npm
  bandwidth.
- **`hermes` on npm is a different package.** Our Hermes has no npm/PyPI presence —
  GitHub only. Not measurable as a download series.
- **`open-webui` on npm is a stub** (355/mo). Real distribution is Docker + PyPI.
- **`n8n` npm is separable from n8n Cloud** (Cloud does not install the package),
  but includes Docker builds and CI — treat as an index, not a headcount.

### The 2×2

|  | **Cloud model (API)** | **Local model (weights)** |
|---|---|---|
| **Self-hosted app** | openclaw · n8n · Hermes · Continue | Ollama · llama.cpp · LM Studio |
| **SaaS app** | GHL · Monday · Zapier · Copilot | *(nearly empty)* |

The mass is in the top-left. The bottom-right is nearly empty.

> **Emerging thesis:** "local AI" is not winning. **Self-hosted orchestration over
> cloud models** is winning.

That is sharper than either "local LLMs vs subscriptions" or "local apps vs cloud
apps," and it is the one the data supports.

---

## 5. PyPI cohort constraint

The pipeline collects PyPI only — no npm leg. So every package in a pillar's
`pypi` array must be **PyPI-native**.

| Package | PyPI/mo | Verdict |
|---|---|---|
| `n8n` | 492 | ✗ npm package, stub on PyPI |
| `openclaw` | 1,624 | ✗ npm package, stub on PyPI |
| `open-webui` | 985,348 | ✓ real |
| `langchain` | 156,867,095 | ✓ real |

`n8n` and `openclaw` are therefore **excluded** from pillar 1's cohort despite
being the headline self-hosted apps. Adding an npm leg is the fix, not padding
the PyPI list with stubs. **The audit agrees — npm is the highest-value addition.**

### Packages deliberately dropped

| Package | Pillar | Why |
|---|---|---|
| `boto3` | `data-persistence` | Downloaded by everything; noise floor swamps `obstore` |
| `pyarrow` | `data-persistence` | Same; moved to `stack-structure` where it is on-pillar |
| `letta` | `temporal-memory` | Superseded by `mem0ai` / `graphiti-core` |

---

## 6. Source-coverage audit (received 2026-11-14)

External review of whether the six legs are the right sources for these five
pillars. **Verdict: pillars preserved; the changes belong in the measurement
layer, not the pillar definitions.**

### Three architectural changes

1. **Separate discovery from measurement.** Find new contenders broadly, then
   track a stable cohort over time. Don't let today's most popular results define
   the dataset.
2. **Store dated observations, not ranked search results.** Every metric needs a
   timestamp, a stable entity ID, a source, and a definition of what it measures.
3. **Add deployment and usage signals.** Downloads and stars describe activity
   around published artifacts. They cannot tell you whether software is deployed,
   retained, or replacing a competitor.

### Per-leg recommendations

| Leg | Verdict | Change |
|---|---|---|
| arXiv | keep, change discovery + counting | `ti:` / `abs:` field-scoped queries + `submittedDate` windows; weekly counts of matching papers; keep one broad query as a recall check |
| Hugging Face | keep, add time-series | `sort=downloads` is a ranking feed, not a growth feed. Persist download counts per stable model ID, diff snapshots |
| GitHub | replace star-ranked discovery | Discover by `created:` date windows, maintain a stable cohort, track weekly star *additions* |
| OpenAlex | change scope, drop citation sort | `default.search` → title/abstract scope; count new works by publication week/month; citation counts become a separate delayed-impact signal |
| PyPI | replace `/recent` | `/recent` is not a historical series. Use BigQuery (or ClickPy) for daily counts |
| USPTO | keep as weak leading indicator | Filings are commercial intent, not adoption. Store filing dates + applicant links |

> **Key distinction:** date-windowed counts are not a replacement for longitudinal
> tracking. Windowed counts tell you what's *entering* the ecosystem; snapshots
> tell you whether existing contenders are *gaining traction*. You need both.

### The missing source category: deployment evidence

> "You're missing an entire category of evidence: **where software is actually
> running and what infrastructure people are choosing to operate**."

Proposed as a **new source category** (`deployment_evidence`), not a seventh leg:

| Source | Value | Caveat |
|---|---|---|
| Container registries (Docker Hub) | Another distribution channel for self-hosted products | Pulls include CI, caching, redeploys |
| Technographics (BuiltWith, Wappalyzer) | Web-visible technology footprint over time | Blind to local apps and private infra |
| Production surveys (CNCF) | Periodic benchmark | Survey-level, not product-specific |
| Cloud marketplace / managed-service disclosures | Shows shift from self-managed to managed | Inconsistent access and reporting |

This matters for both blind spots: pillar 1 needs to know whether users run the
software themselves, and pillar 4 needs architecture evidence to distinguish
local disk from object store from managed cloud. **Container distribution alone
cannot tell you where a running instance stores its data.**

### Momentum arithmetic

Track three dimensions separately per contest:

- **Adoption activity** — package downloads, model downloads, container pulls, marketplace installs, disclosed seats
- **Ecosystem momentum** — new repos, releases, new packages, publications, integrations
- **Deployment evidence** — observed footprints, surveys, disclosed deployment counts

Two-sided share:

```
S_A(t) = A(t) / (A(t) + B(t))
ΔS_A   = S_A(t) − S_A(t − 28d)
```

`A(t)` and `B(t)` must be **comparable and consistently measured over the same
period**. Downloads from comparable registries, or paid seats from comparable
disclosures — never GitHub stars on one side and revenue on the other.

For heterogeneous sources, compute a separate share index per metric, normalize,
then combine with documented weights. **If one side is unmeasured, report
`coverage incomplete` — do not manufacture a 50/50 comparison.**

### Immediate fix list

| # | Action | Status |
|---|---|---|
| 1 | Correct OpenAlex docs to reflect live `default.search` | ✅ done (§7) |
| 2 | Review and enable `OpenAlex WEEKLY` | ⬜ inspect date window + aggregation first |
| 3 | Add daily npm download-history leg | ✅ **locked — see §6.1** |
| 4 | Replace PyPI `/recent` with daily aggregates | ⬜ **cheaper than expected — see §7.4** |
| 5 | GitHub discovery → `created:` windows + star backfill | ⬜ recommended next |
| 6 | Date-windowed, title/abstract-scoped arXiv + OpenAlex | ⬜ |
| 7 | Add metric coverage + source confidence fields | ⬜ |
| 8 | Demote USPTO to unscored discovery feed | ✅ **locked — see §6.2** |

> **On the disabled `OpenAlex WEEKLY` node:** don't enable it blindly. Inspect its
> date window, aggregation logic, and whether it produces the same metric as the
> live node first.

---

## 6.1 LOCKED — npm leg

**Decision 2026-11-14: add a daily npm leg.** Highest-value single change.

### Why

`n8n` and `openclaw` are npm packages. Their PyPI entries are stubs (492 and
1,624/mo), so pillar 1's two headline self-hosted apps are currently invisible.
npm has data back to **2015-01-10**, needs no auth, and has no documented rate
limit.

### Endpoint — bulk is the answer

```
GET https://api.npmjs.org/downloads/range/{start}:{end}/{pkg1,pkg2,...}
```

**Comma-separated bulk queries work on `/range`** — up to **128 packages per
request**. This turns 15 requests into 1 and eliminates the 429 problem entirely.

Response is a **top-level object keyed by package name**, not an array:

```json
{
  "n8n":      {"start":"2026-11-08","end":"2026-11-14","package":"n8n",
               "downloads":[{"downloads":13330,"day":"2026-11-08"}, ...]},
  "openclaw": {"start":"...","end":"...","package":"openclaw","downloads":[...]}
}
```

Parse with `Object.entries(resp)`. A single-package request returns the *unwrapped*
form (`{downloads, package, start, end}`), so the parser must handle both.

### Scoped packages are NOT supported in bulk

| Test | Result |
|---|---|
| `n8n,openclaw,langchain` (11 unscoped) | **200** ✅ |
| 128 packages | **200** ✅ |
| 129 packages | **400** ❌ hard cap |
| `n8n,@anthropic-ai/sdk` | **400** `scoped packages are not currently supported in bulk lookups` |
| `n8n,@anthropic-ai%2Fsdk` (encoded) | **400** — encoding does not help |
| `@anthropic-ai/sdk` alone | **200** ✅ |

So the leg splits the cohort: **one bulk call for unscoped, one call each for
scoped**. Our cohort is 11 unscoped + 4 scoped = **5 requests**, down from 15.

### Rate limits — undocumented, measured

No published numeric limit. The API sits behind Cloudflare; 429 body is 17 bytes
of `text/plain`.

| Pattern | Result |
|---|---|
| 15 sequential, 0ms | 15× 200 — **but all `CF-Cache-Status: HIT`** (cache artifact, not headroom) |
| 40 sequential, 0ms, cache-busted | 40× **429** |
| 15 @ 500ms | ~47% fail |
| 15 @ 1200ms | ~27% fail |
| 15 @ 2000ms after cooldown | **15× 200** ✅ |

`Retry-After: 0` is returned but useless — this is a burst limiter that refills in
~5s, not a sustained-throughput limiter.

**Our config:** batch size 1, 2500 ms interval, 4 retries at 5 s. With bulk this
only governs the 4 scoped calls.

### Caching

```
Cache-Control: public, max-age=300
Last-Modified: Sat, 14 Nov 2026 11:49:40 GMT
CF-Cache-Status: HIT | MISS | EXPIRED
```

No `ETag`. `If-Modified-Since` works and returns **304 with 0 bytes**. Since data
updates once daily after UTC midnight, local caching for 6–24 h is safe.

### Cohort — verified 2026-11-14 (last-week downloads)

| Package | npm/week | Pillar |
|---|---|---|
| `@anthropic-ai/sdk` | 69,410,759 | 1 (cloud side) |
| `@aws-sdk/client-s3` | 73,424,490 | 4 — **excluded**, noise floor |
| `openai` | 58,304,855 | 1 (cloud side) |
| `apache-arrow` | 10,332,464 | 5 |
| `langchain` | 4,002,921 | 1 |
| `openclaw` | 3,078,703 | 1 |
| `neo4j-driver` | 1,399,143 | 3 |
| `minio` | 1,162,363 | 4 |
| `n8n` | 104,988 | 1 |
| `@qdrant/js-client-rest` | 940,336 | 3 |
| `@databricks/sql` | 728,842 | 5 |
| `@lancedb/lancedb` | 502,196 | 3 |
| `duckdb` | 272,312 | 3 |
| `mem0ai` | 230,573 | 2 |
| `hnswlib-node` | 130,506 | 3 |
| `usearch` | 62,858 | 3 |
| `lancedb` | 730 | — **stub**, use `@lancedb/lancedb` |

### Rules

- **Never sum npm and PyPI downloads.** Different registries, different
  populations. Score each registry's growth separately, then combine as a family.
- `@aws-sdk/client-s3` is excluded for the same reason `boto3` was — downloaded by
  everything, noise floor swamps `minio`.
- `lancedb` (730/wk) is a stub; the real package is `@lancedb/lancedb`.
- Isolated `0` values in the range response are gaps, not real zero-download days.
  The parser records `zero_days` so the UI can flag them.
- Data lands once daily after UTC midnight — "today" is usually absent, so the
  last day of every window reads `0`. Expected, not an error.
- **Scoped package names contain `/`**, which `WriteBinaryFile` treats as a
  directory separator. Filenames replace `/` with `__`
  (`self-hosted-vs-saas-@anthropic-ai__sdk-2026-11-14.jsonl`).

### Verified 2026-11-14 — end-to-end

Run `15759`: all 5 legs `ok`, 61 items through Gate, 15 npm files written.

| Package | 7d total |
|---|---|
| `@anthropic-ai/sdk` | 62,852,872 |
| `openai` | 52,882,786 |
| `apache-arrow` | 9,543,911 |
| `langchain` | 3,720,860 |
| `openclaw` | 2,585,180 |
| `neo4j-driver` | 1,298,595 |
| `minio` | 1,051,100 |
| `@qdrant/js-client-rest` | ~940,000 |
| `@databricks/sql` | ~729,000 |
| `@lancedb/lancedb` | 449,314 |
| `duckdb` | 252,861 |
| `mem0ai` | 202,635 |
| `hnswlib-node` | 119,956 |
| `n8n` | 89,166 |
| `usearch` | 56,689 |

---

## 6.2 LOCKED — USPTO demoted to unscored discovery feed

**Decision 2026-11-14: keep USPTO daily, but take it off the Gate path and out of
any score.**

### Why it cannot be scored

| Metric | Value |
|---|---|
| Cases scanned per day | ~63,000 |
| Matches per day | **2–5** |
| Zip size | 27 MB (not 55 MB — that was the old figure) |
| XML parsed | ~1.08 GB |
| CPU time | ~13.5 s |
| Filing → appearance lag | **~3.5 months** |

At 3 hits/day, Poisson noise is **±58%** on a daily window. Distinguishing
"3/day" from "4.5/day" (+50%) at 95% confidence needs **~100 hits per window** —
about 33 days — and even then it is ±20%.

| Granularity | Usable? |
|---|---|
| Daily | ✗ noise dominates |
| Weekly | ✗ noise dominates |
| Monthly | ~ marginal |
| Quarterly | ✓ but 4 points/year |

**USPTO cannot produce a momentum score.** The 10% weight in the earlier scoring
model was unjustified.

### Signal quality is high — keep it as discovery

The hits are genuinely good. From the 2026-11-12 extract:

- **CVOYA LLC** — "software for modeling, querying, storing, retrieving, and
  managing graph-structured data… connect to and interact with graph databases"
- **Netsdk Software FZE** — "software for browsing, uploading, downloading… cloud
  object storage"

USPTO answers *"who is entering this arena?"* — which nothing else in the stack
answers. It does not answer *"is this arena growing?"*

### Why not move it to the weekly OpenAlex leg

Two things break:

1. **The daily run hangs.** `Merge Validations` has `numberInputs: 5`. If USPTO
   stops firing on the daily cron, Merge waits forever for input 4.
2. **6/7 of the data is lost.** The TDXF file holds *every trademark case with
   activity that day*. Weekly polling gets one day's filings per week, not the
   week's.

The 6-requests-per-file-per-7-days cap is **per file**, and each daily TDXF is a
different file — so one request per day is nowhere near the cap. Daily USPTO is
cheap. The problem was never cost; it was that USPTO noise blocked uploads and
polluted the score.

### The change

```
USPTO TMs → Find Latest TDXF → USPTO File List → Pick Latest File
          → Download TDXF → Write TDXF → Extract USPTO Gems → Validate USPTO
                                                                    ↓
                                                            (terminal — no Gate)
```

| | Weekly on OpenAlex leg | Daily side-channel |
|---|---|---|
| Data coverage | 1/7 | full |
| Blocks uploads on failure | yes | **no** |
| Pollutes score | no | no |
| Merge rewiring | needed | needed (remove input 4) |
| Complexity | one trigger, two legs | one extra terminal node |

**Bonus:** this closes open item #3 ("don't halt everything on a USPTO failure")
for free — USPTO cannot halt anything if it never reaches Gate.

### Resulting leg table

| Leg | Schedule | Role |
|---|---|---|
| arXiv | daily | scored — research |
| Hugging Face | daily | context only |
| GitHub | daily | scored — developer activity |
| PyPI | daily | scored — package adoption |
| **npm** | **daily (new)** | **scored — package adoption** |
| OpenAlex | weekly | scored — research |
| USPTO | daily | **discovery only, unscored** |
| Docker Hub | — | MD note only, no leg |

### Revised scoring model

Four families become three scored ones. USPTO drops out entirely:

```
Momentum = 0.30*R + 0.35*G + 0.35*P
```

Where `P` is PyPI **and** npm, scored separately then combined — never summed.

> **Caveat to surface in the UI:** dropping USPTO from scoring means the model has
> no "money is moving" signal at all. That is honest — we do not have one — but the
> dashboard must say so rather than implying the composite covers commercial intent.

---

## 7. Verified API facts (2026-11-14)

Every claim in the audit was independently checked against live endpoints. Two
material corrections.

### 7.1 GitHub historical star API — VERIFIED

`GET https://api.github.com/repos/{owner}/{repo}/stargazers/history`

Announced 2026-09-04. Returns **HTTP 200 unauthenticated**:

```json
[{"week":1794096000,"total":781,"days":[99,111,135,184,131,109,12]}, ...]
```

`week` is a unix timestamp (Sunday UTC); `days` is a 7-element array with **no
per-day labels** — derive dates from `week` + index.

**Caveats the audit omitted:**

- **Paginated** — 30 weeks per page. `ollama/ollama` needs 6 pages.
- **Not a true historical record** — it returns *stars created on each date that
  remain active today*. **Unstars are not tracked**, so past weeks can silently
  shrink.
- **60 req/hr unauthenticated** — the standard anon limit, not unlimited.

### 7.2 npm downloads API — VERIFIED

`GET https://api.npmjs.org/downloads/range/{start}:{end}/{package}` → daily
granularity confirmed.

- Earliest data: **2015-01-10** (`2015-01-01:2015-01-05` → HTTP 400)
- Max **18 months** per query; **365 days / 128 packages** for bulk
- No documented rate limit
- Data lands once daily after UTC midnight — "today" is usually absent
- Isolated `0` values are gaps, not real zero-download days

### 7.3 Docker Hub — **FALSE as stated**

The audit said "track Docker Hub image pulls." There is **no historical pull
endpoint**. Only current all-time totals:

| Image | `pull_count` |
|---|---|
| `n8nio/n8n` | 285,719,882 |
| `ollama/ollama` | 200,335,017 |

All history endpoints return **404** (`/pulls/history`, `/statistics`, `/metrics`).
The only historical pull data Docker offers is an org-owner-authenticated CSV —
unusable for third-party images.

**GHCR and Quay expose no pull counts at all.**

> **Consequence:** container tracking requires our own snapshot storage from day
> one. It is a *forward-only* signal — no backfill is possible. That makes it
> lower priority than npm, which has 10 years of history.

### 7.4 PyPI — VERIFIED, with a cheaper path than BigQuery

**BigQuery dataset is real:** `bigquery-public-data.pypi.file_downloads`.
Event-level, partitioned by day on `timestamp` — **not pre-aggregated**, so daily
counts need `GROUP BY DATE(timestamp)`. History from ~2016-01-22.

**Two durability caveats the audit omitted:**

- Linehaul **under-reported by ~10× before 2018-07-26**
- The 2026-08-24 break is **permanent** — metadata-only requests (PEP 658
  `.metadata` sidecars, ~40% of prior volume) are no longer counted. Historical
  rows were not rewritten.

**1 TiB/month free tier: TRUE** — but **misattributed**. `docs.pypi.org` says
nothing about it. The figure appears in the PyPA guide and on pypistats.org.

**The cheaper path — `pypistats /overall` already gives 180 days of daily data:**

```
GET https://pypistats.org/api/packages/ollama/overall
→ 181 daily points, 2026-05-17 → 2026-11-13
→ categories: with_mirrors | without_mirrors (?mirrors=false)
```

So the "snapshotting gates everything" claim in earlier notes was **too
pessimistic**. We can backfill 180 days immediately with one endpoint, no auth,
no cost. BigQuery becomes the *long-run* answer, not the blocker.

**ClickPy** (ClickHouse public dataset) is a free, no-auth SQL-over-HTTP
alternative with history from 2016-01-22:

```
https://sql-clickhouse.clickhouse.com/?user=play&query=...
tables: pypi.pypi_downloads_per_day (date, project, count)
```

It is a **mirror of the same BigQuery feed**, so it inherits both caveats. A
convenience, not an independent source.

### 7.5 OpenAlex — VERIFIED, with a nuance

| Form | HTTP | `meta.count` (lakehouse) |
|---|---|---|
| `filter=default.search:` | 200 | 3227 |
| `filter=fulltext.search:` | 200 | 3227 |
| `search=` | 200 | 3227 |
| `filter=title.search:` | 200 | 519 |
| `search.title_and_abstract=` | 200 | 1099 |

`default.search` is a deprecated alias of **`fulltext.search`** specifically —
not "broad full-text search" generically. It still works and behaves identically.

**Date filtering:** `from_publication_date` / `to_publication_date`. Verified:
`title.search:lakehouse` + 2025 range → 119 (down from 519).

**Rate limits changed:** the "polite pool" was **replaced by API keys in February
2026**; `mailto` is now ignored. 10 req/s keyless, 30 req/s free key. A key is
required for cursor paging past page 1. Keyless shares a **$0.10/day IP budget**.

### 7.6 arXiv — VERIFIED

`submittedDate:[YYYYMMDDTTTT+TO+YYYYMMDDTTTT]` works and genuinely narrows:
`ti:"graph database"` → 117 unfiltered, **12** with a 2026 range. 3-second delay
is a documented *request*, not an enforced limit. `max_results` caps at 30,000.

### 7.7 Hugging Face — VERIFIED

`downloads` is a **rolling 30-day** metric (confirmed by HF staff). It can
*decrease* as the window slides — it cannot measure growth.

**No public historical endpoint exists.** The 401s on `/downloads` and `/stats`
are an auth-gated catch-all (a nonsense control path also returns 401), not
evidence of a real endpoint. HF's answer for granular history is Publisher
Analytics — org-scoped, not public.

`expand[]=downloadsAllTime` exists but is not returned by default.

### 7.8 CNCF survey — VERIFIED, all figures exact

82% of container users run Kubernetes in production; 66% of orgs hosting GenAI
models use Kubernetes for some or all inference. Published **2026-01-20**.

Caveat: 82% is *of container users*, not of all organizations. 44% of orgs still
run no AI/ML on Kubernetes.

### 7.9 Technographics — VERIFIED, expensive

| Tool | Historical | Price |
|---|---|---|
| BuiltWith | Domain API (historical + confidence), Change API (additions/removals), Trends API | **$295/mo** Basic, $495 Pro, $995 Team; credits separate |
| Wappalyzer | Monthly groupings via `squash=false` + `max_age=N` | **$450/mo Business — hard gate.** Free tier (50 lookups) does not include it |

The audit's "paid beyond a limited free allowance" understates Wappalyzer: the
historical feature is not available on any tier below Business.

---

## 8. Known gaps

### Pillar 1's SaaS side is partly measurable

The audit's answer: **partly, but not symmetrically.**

| Signal | Value | Limitation |
|---|---|---|
| Extension marketplace installs | Strong for IDE products | Not all products publish counters |
| Official customer / paid-seat disclosures | Strong when product-specific and repeated | Quarterly; definitions vary |
| App-store rankings | Directional | Ordinal, volatile |
| Public integration counts | Ecosystem breadth | Integrations ≠ active users |
| Web traffic estimates | Directional reach | Not usage or paid adoption |
| Search / social mentions | Attention | Not adoption share |

**Recommendation adopted:** build an explicit **per-contender measurement-coverage
field**. A missing SaaS metric shows as a gap, never silently replaced with the
other side's unrelated metric.

### Pillar 3's relational baseline is invisible

Postgres has no repo to star and no growth signal — `psycopg2`/`asyncpg` downloads
are flat noise. The pillar can show graph/vector *gaining*, not tables *losing*.

Mitigation: track `psycopg`, `asyncpg`, `sqlalchemy`, `duckdb` as a **baseline
cohort**, labelled as a reference line rather than a scored contender.

### Pillar 4's cloud side is partly blind

Managed cloud storage (S3, R2, GCS) has no download signal. Same treatment:
baseline, caveat visible. This is exactly what `deployment_evidence` would fix.

### Snapshotting — less urgent than previously thought

`pypistats /overall` backfills 180 days today; ClickPy backfills to 2016. So
PyPI history is **not** lost. But npm, GitHub stars, and Docker pulls are all
forward-only from our first snapshot — those still need to start now.

---

## 9. Scoring model (not yet implemented)

Growth over counts. Per source:

```
growth = ln((current_window + alpha) / (previous_window + alpha))
```

Normalize against a trailing baseline, then combine across **three scored
evidence families** — not six equally weighted APIs:

| Family | Weight | Source |
|---|---|---|
| Research | 30% | arXiv + OpenAlex (**one** family, deduplicated) |
| Developer activity | 35% | GitHub |
| Package adoption | 35% | PyPI **and** npm, scored separately then combined |
| Hugging Face | **0%** in core score | context overlay only |
| USPTO | **0%** — discovery only | see §6.2 |

```
Momentum = 0.30*R + 0.35*G + 0.35*P
```

> **Changed 2026-11-14.** USPTO was 10% of the composite. At 2–5 matches/day its
> noise is ±58% on a daily window, so that 10% was driven by sampling noise rather
> than signal. It is now a discovery feed with no score. The model has **no
> commercial-intent family at all** — the UI must say so.

Rules:

- Missing families **renormalize**; they never score zero. "No eligible evidence"
  ≠ "evidence of decline."
- Confidence shrinks sparse results toward the midpoint:
  `adjusted = 50 + confidence * (raw - 50)`.
- Breakout requires positive momentum in **≥2** independent families; high
  confidence requires ≥3.

### Three outputs per pillar

- **Momentum** — normalized score across applicable families
- **Coverage** — how many independent families contributed
- **Confidence** — whether samples are large enough and signals agree

### Popularity vs momentum vs winning

- **Popular** — high cumulative stars, downloads, citations
- **Accelerating** — normalized growth above its recent baseline
- **Winning** — gaining share against competitors over multiple windows, with
  corroboration from independent families

Only the third answers the pillar's question.

### Contest share (added by audit)

For two-sided contests, compute share directly rather than comparing composites:

```
S_A(t) = A(t) / (A(t) + B(t))
ΔS_A   = S_A(t) − S_A(t − 28d)
```

Requires comparable measurement on both sides. Where one side is unmeasured,
report `coverage incomplete`.

---

## 10. Open questions

| # | Question | Status |
|---|---|---|
| 1 | Is `openclaw`'s 11.4M/mo real, or a dependency-of / CI mirror? | open |
| 2 | Add an npm leg so `n8n` and `openclaw` become measurable? | ✅ **locked — §6.1** |
| 3 | Add a SaaS data source for pillar 1's right side? | partly — marketplace installs + disclosures; coverage field |
| 4 | OpenAlex syntax | **resolved** — `default.search` aliases `fulltext.search`; use `title.search` / `title_and_abstract` + date filters |
| 5 | Start daily snapshots | **PyPI not urgent** (`/overall` backfills 180d); npm/GitHub/Docker are forward-only |
| 6 | Add `deployment_evidence` source category? | recommended — prototype Docker Hub + small technographics sample |
| 7 | Enable `OpenAlex WEEKLY`? | inspect date window + aggregation first |
| 8 | Docker Hub leg? | **no leg** — no history API, forward-only. MD note only |

### Recommended order

1. ~~**npm leg**~~ — ✅ **done, §6.1**
2. **GitHub star backfill** — new API removes the polling problem
3. **PyPI `/overall`** — 180-day backfill today, no BigQuery needed yet
4. **arXiv + OpenAlex date-windowed queries** — switch from popularity to momentum
5. **`deployment_evidence` prototype** — Docker Hub snapshots + small technographics sample

---

## 11. Reference

- `archive/pillars_research_11_12_2026.md` — first research response (arena model)
- `archive/pillars.arenas.json` — research's arena definitions
- `archive/arena_query_plan_60.csv` — 60 source-specific queries

> **Note:** the research uses its own ids (`personal-data-plane`,
> `object-first-persistence`, `lakehouse-platforms`). Those are **not** our ids.
> Our pillar 1 (`self-hosted-vs-saas`) is a different contest from the research's
> `personal-data-plane` (local ingestion and on-device runtime). The research
> files are reference material, not source of truth.

### Live endpoint reference

| Source | Endpoint | History | Auth |
|---|---|---|---|
| arXiv | `export.arxiv.org/api/query?search_query=…` | full | none |
| Hugging Face | `huggingface.co/api/models?search=…` | **none** (rolling 30d) | none |
| GitHub search | `api.github.com/search/repositories?q=…` | n/a | none (60/hr) |
| GitHub stars | `api.github.com/repos/{o}/{r}/stargazers/history` | weekly, paginated | none (60/hr) |
| OpenAlex | `api.openalex.org/works?filter=title.search:…` | full | key for paging |
| PyPI recent | `pypistats.org/api/packages/{p}/recent` | **none** | none |
| PyPI daily | `pypistats.org/api/packages/{p}/overall` | **180 days** | none |
| PyPI long | BigQuery `pypi.file_downloads` / ClickPy | 2016→ | GCP / none |
| npm | `api.npmjs.org/downloads/range/{a}:{b}/{p}` | 2015→ | none |
| Docker Hub | `hub.docker.com/v2/repositories/{ns}/{r}/` | **current only** | none |
| USPTO | bulk TDXF zip | full | ODP key |
