# Momentum Engine — Read Me First

A plain-language guide to what this app is, why it exists, and what it produces.
No coding knowledge assumed. Every technical term is explained in brackets the
first time it appears.

For the machine-readable version (functions, parsing rules, node wiring), see
[`techREADME.md`](./techREADME.md).

---

## 1. What This App Is

- **One sentence:** it watches five fast-moving areas of computing, collects
  evidence of what is growing, and turns that evidence into charts that show
  where each area is heading.
- **It is a forecasting instrument, not a news feed.** The goal is not "what
  happened today" but "which of these five areas is accelerating, which is
  stalling, and what is about to matter."
- **It runs itself.** A scheduled job wakes up every morning, collects fresh
  data from seven public sources, checks it for damage, and files it away.
- **It asks permission when something looks wrong.** If a source returns
  broken or empty data, the run stops and a person is asked to approve or
  reject the upload before anything is written.

### The five areas being tracked (called "pillars")

A **pillar** (one of five technology contests this app follows) is a bet on where
computing infrastructure is going. Each pillar is tracked by searching for its
keywords across every data source.

Each pillar is a **contest** — two ways of doing the same job, and the app tracks
which one is gaining ground.

| Pillar | The contest | Why it matters |
|---|---|---|
| **Self-hosted AI Apps vs SaaS AI Apps** | Run the orchestration yourself, or rent it | Whether AI tooling gets owned by the user or rented per-seat |
| **Temporal Memory & Context** | Remembering what changed, or just recalling text | The difference between a chatbot and an assistant that knows you |
| **Retrieval Strategy** | Joins · hops · keywords · vectors · column scans | Five ways to find the right data, all competing for the same job |
| **Where Durable State Lives** | Local disk · object store · managed cloud | Where the bytes physically sit, and what that costs |
| **Open Format vs Integrated Platform** | Assemble from open parts, or buy one vendor's box | Who ends up owning the data stack |

> **Note on pillar 1:** the self-hosted side is directly measurable (npm/PyPI
downloads). The SaaS side mostly is not — GHL, Monday and Zapier publish no
counts. Only IDE extensions have public install numbers. Until a SaaS data
source is added, the SaaS side is shown as a flat baseline with that caveat
visible in the UI.

---

## 2. Why These Seven Sources

Each source is a different *kind of evidence*. None of them alone tells you
where a technology is going. Together they form a timeline: research first,
then code, then adoption, then money.

| Source | What it is | What it tells you | Time lag |
|---|---|---|---|
| **arXiv** | A public archive of research preprints (papers posted before peer review) | What researchers are excited about *right now* | Days |
| **GitHub** | The main website where programmers publish and share code | Whether developers are actually building with it | Weeks |
| **Hugging Face** | A public library of downloadable AI models | Whether the models exist and are being downloaded | Weeks to months |
| **PyPI** | The Python Package Index — the public catalogue of installable Python software | Whether real products are installing it in production | Months |
| **npm** | The package registry for JavaScript — the equivalent of PyPI for web and server-side JavaScript | Whether web tooling and JavaScript products are adopting it | Months |
| **OpenAlex** | A free index of scholarly papers and who cites whom | Whether the idea has academic weight behind it | Months to a year |
| **USPTO** | The United States Patent and Trademark Office | Whether companies are spending money to own the name | One to three years ahead |

### Reading the sequence

- **Research appears first.** A new idea shows up as a paper on arXiv.
- **Code follows.** Someone publishes a library on GitHub.
- **Models get packaged.** The idea becomes a downloadable model on Hugging Face.
- **Production adopts it.** Companies install the package from PyPI, and the
  download numbers climb.
- **Academia ratifies it.** Citations accumulate in OpenAlex.
- **Money arrives.** Trademarks get filed at the USPTO — the strongest signal
  that a company intends to sell something.

A pillar where all seven are rising is a genuine wave. A pillar where papers are
rising but downloads are flat is hype. A pillar where trademarks are being filed
but nothing else is moving is a company bet you cannot see yet.

---

## 3. How It Works — Numbered Flow

### The whole picture, in one chart

Read this top to bottom. Each box is a place data physically sits; each arrow is
something that moves it.

```
  YOUR LAPTOP  (Windows)
  ─────────────────────────────────────────────────────────────

     ┌──────────────────┐
     │      n8n         │   the collector
     │   (workflow)     │   wakes at 05:00, asks 7 websites for data
     └────────┬─────────┘
              │  writes plain text files
              ▼
     data/<source>/raw/*.jsonl        ← JSONL: one record per line
              │
              │  uploads them (Databricks cannot reach the internet,
              │  so the push has to come from here)
              │
  ────────────┼─────────────────────────────────────────────────
              ▼
  DATABRICKS  (cloud)
  ─────────────────────────────────────────────────────────────

     UNITY CATALOG VOLUME
     /Volumes/momentum/momentum/landing/
       arxiv/  github/  huggingface/  npm/
       openalex/  pypi/  uspto/
              │
              │  these raw files ARE the Bronze layer
              │  (never edited, never deleted)
              ▼
     ┌────────────────────────────────────┐
     │  SILVER notebook                   │
     │  reads every file, cleans it       │
     └───────────────┬────────────────────┘
                     │  writes a Delta table
                     ▼
     momentum.momentum.silver_nodes
              │
              │  one clean row per thing, per pillar, per day
              ▼
     ┌────────────────────────────────────┐
     │  GOLD notebook                     │
     │  adds up the numbers               │
     └───────────────┬────────────────────┘
                     │  writes two Delta tables
                     ▼
     momentum.momentum.gold_level     (how big each thing is)
     momentum.momentum.gold_volume    (how many things appeared)
              │
  ────────────┼─────────────────────────────────────────────────
              ▼
  THE APP  (runs inside Databricks, reads only Gold)
  ─────────────────────────────────────────────────────────────

     Momentum Board  ·  Graph Explorer  ·  Ask + Lineage
     Setup / Pillars  ·  Logs
```

### The five words in that chart, explained

These get used loosely everywhere, so here is what each one actually is.

| Word | What it really is | Where it sits in the chart |
|---|---|---|
| **Lakehouse** | An *architecture*, not a product. A data lake (cheap cloud storage holding plain files) with warehouse-style table features layered on top. It is the reason one system can hold both raw files and queryable tables. | The whole Databricks box |
| **Delta Lake** | The *table format*. It makes a folder of files behave like a real table: safe concurrent writes, schema enforcement, and the ability to undo. It works by keeping a transaction log (`_delta_log`) next to the data files. | Silver and Gold tables |
| **Parquet** | A *file format*. Columnar and compressed — great for scanning millions of rows, useless for reading by eye. Delta tables store their data as Parquet files underneath. | Inside every Delta table |
| **Volume** | A *folder* in Databricks' cloud storage, with permissions attached. Not a table — just files. | Where Bronze lives |
| **Bronze / Silver / Gold** | Three *stages of refinement*, not three products. Raw → cleaned → summarised. | The three layers in the chart |

**The key distinction:** a **Volume** holds *files*; a **Delta table** holds *rows you
can query*. Bronze is files. Silver and Gold are tables. That is the single
biggest difference between the top and bottom halves of the Databricks box.

**Why Parquet never appears in your day-to-day.** You never open a Parquet file.
It is a storage detail inside Delta. You query the table by name and Databricks
handles the files. (The old Silver script tried to read Parquet directly and
failed — the ingestion layer writes JSONL, not Parquet.)

**Is this a database?** Not in the usual sense. There is no server holding your
rows in memory, no indexes to tune, no connection pool. A Delta table is *files
plus a log*, queried by a SQL engine. That is why re-running a whole notebook is
cheap and safe here — and why the app should read Gold rather than query Delta on
every page load.

### Flow A — Daily collection (scheduled 05:00)

1. **A timer fires.** A scheduled job (called a **cron** — a timer written as
   five numbers meaning minute, hour, day, month, weekday) starts the run.
   *The timer is currently switched off while the UI work happens — see §7.*
2. **The keyword list is loaded.** One central list holds the five pillars and
   the search terms for each. This is the only place to change what gets
   searched.
3. **Six collectors run in parallel.** One each for arXiv, GitHub, Hugging
   Face, PyPI, npm, and USPTO. Each asks its source for the newest matching
   records. (OpenAlex is the seventh, but it runs weekly — see Flow B.)
4. **Each collector reshapes its answer.** Every source returns data in a
   different layout. A small translation step (a **parse** — converting one
   data layout into another) rewrites each answer into one shared format.
5. **The shared format is written to disk.** One text file per pillar per
   source, named with the date. The format is **JSONL** (JavaScript Object
   Notation Lines — a text file where each line is one complete record, so a
   damaged line does not ruin the rest of the file).
6. **Every file is inspected.** A checking step (**validation** — confirming the
   data is complete and correctly shaped) reads each file back and looks for
   missing fields, wrong labels, duplicate entries, and empty files.
7. **A single decision is made.** One gate looks at all the reports together and
   chooses one of two paths.
8. **Clean run → upload.** If every file passed, the files are sent to cloud
   storage and the run ends.
9. **Dirty run → ask a human.** If any file failed, the run pauses and a
   message with Approve and Decline buttons is posted to a team chat channel.
   This is **HITL** (Human In The Loop — a person makes the call instead of the
   software).
10. **The human decides.** Approve sends the healthy files onward and discards
    the broken ones. Decline stops the run entirely. If nobody answers within
    twelve hours, the run expires.

### Flow B — Weekly research sweep (runs Monday 09:00)

1. The same keyword list is loaded.
2. Only the OpenAlex collector runs.
3. Results are reshaped, written, validated, and gated exactly as in Flow A.
4. OpenAlex is weekly rather than daily because citation counts move slowly —
   checking them every day would waste the free quota.

### Flow C — From files to charts

1. **Files land in cloud storage.** The upload step places them in a folder
   (**a Volume** — a shared folder inside Databricks' cloud storage) organised
   by source. One folder per source, flat: `landing/arxiv/`, `landing/npm/`,
   and so on.
2. **Bronze stage.** The raw files sit there as-is. Nothing is cleaned. This is
   the permanent record of what arrived, and it is never edited — if a later
   step is wrong, it is re-run over the same bytes. Bronze is *files*, not a
   table: you cannot query it by name, only read the files.
3. **Silver stage.** A notebook (a script that runs inside Databricks) reads
   every raw file and produces one clean table. See §3.1 below for exactly what
   it does — this is the stage that turns messy files into something a graph can
   be built from.
4. **Gold stage.** A second notebook aggregates Silver into daily totals per
   pillar per source — the numbers that feed the charts. Gold produces two
   tables: `gold_level` (how big each thing is) and `gold_volume` (how many
   things appeared).
5. **The app reads Gold.** The dashboard queries the summary tables, not the raw
   files, so it stays fast.

### 3.1 What Silver actually does

Silver is **not** where the graph is built. It is where the data stops being
files and becomes a reliable table. Four jobs, in order:

| Job | What it means in practice |
|---|---|
| **Read** | Open every `.jsonl` file across all seven source folders as one dataset |
| **Type** | Convert text into real types — the timestamp string becomes a real date, and the per-source attribute blob becomes a uniform key/value list |
| **Dedup** | Keep one row per thing per day, discarding repeat sightings within the same day |
| **Write** | Save the result as a Delta table, `momentum.momentum.silver_nodes` |

**The grain — the most important idea here.** One row is *not* one thing. One
row is **one thing, on one pillar, on one day**. A GitHub repo that matches four
pillars produces four rows. That is deliberate: a pillar is a *tag*, not an
attribute. If you deduplicated on the thing alone, you would keep one tag and
silently throw away the other three.

**Why keep one row per day.** If a package is seen on four days, it gets four
rows. That history is the whole point — momentum is a *change over time*, and
you cannot compute a change from a single snapshot. Gold reads this history to
work out what is rising.

**The identity key.** Every row carries a `node_key`, a short fingerprint built
from the thing's ID plus its pillar. Two rows with the same key are the same
observation, which is what makes re-running the notebook safe: it rebuilds the
table from scratch every time and always lands on the same answer.

**What Silver does *not* do.** It does not create relationships (edges). It does
not score anything. It does not decide what is growing. Those are Gold's job,
and Gold cannot start until Silver is right — which is why this stage was the
blocker.

### 3.2 The `duckdb` / `minio` / `mem0ai` / `usearch` confusion

If you look in the Silver table you will see names like `duckdb`, `minio`,
`mem0ai`, and `usearch` appearing twice, once tagged `npm` and once tagged
`pypi`. **These are not tools the app uses.** They are not installed, imported,
or run anywhere in this project.

They are **subjects being measured** — the same way a weather app records
"rain" without being made of rain. They appear because they are on the watch
list in the keyword file:

| Name | Why it is watched |
|---|---|
| `duckdb` | An embedded analytics database — evidence for the *Open Format vs Integrated Platform* pillar |
| `minio` | Self-hosted object storage — evidence for the *Where Durable State Lives* pillar |
| `mem0ai` | An AI memory library — evidence for the *Temporal Memory* pillar |
| `usearch` | A fast similarity-search library — evidence for the *Retrieval Strategy* pillar |

Each one exists as **two separate packages** — a Python version on PyPI and a
JavaScript version on npm. They are different codebases with different download
counts, so they must be counted separately. That is why the ID carries the
registry name (`pypi:minio` vs `npm:minio`).

> **A note on the word "memory".** Databricks has its own memory and caching
> features, and `mem0ai` sounds like it might be one of them. It is not. Nothing
> in this app configures Databricks memory, indexing, or caching. The only
> Databricks features in use are the Volume (file storage), Delta tables (the
> Silver and Gold tables), and a SQL warehouse (the query engine).

---

## 4. What You Get At The End

Five screens, all reading from the same Gold tables. Charts are plain bar, line
and pie — drawn by Databricks' own dashboard tool, so no custom chart code is
needed.

### 4.1 Momentum Board

- **What it shows:** one line per pillar, plotted over time, for each kind of
  evidence — paper volume, repo stars, model downloads, package installs,
  citations, trademark filings.
- **What it answers:** which pillar is accelerating, which has flattened, and
  which is rising in one signal but not the others.
- **The key chart:** a "signal divergence" view. When paper volume rises while
  package downloads fall, that pillar is losing momentum despite looking busy.
- **Why it is useful:** it converts seven unrelated numbers into one comparable
  shape, so you can rank the five pillars against each other.

### 4.2 Graph Explorer

- **What it shows:** a two-dimensional map where each dot is a paper, repo,
  package, model, or trademark, and each line is a real connection between them.
- **Two drawing engines.** You can switch between **Cytoscape.js** (a standard,
  well-tested graph library) and **Force Graph** (a live physics simulation where
  dots repel each other and links pull them together). Same data, same colours —
  different feel. Both have a settings panel so you can tune the spacing yourself.
- **What it answers:** how an idea travels. Follow a paper to the repo that
  implemented it, to the package that shipped it, to the trademark that
  commercialised it.
- **Why it is useful:** it exposes the path from research to revenue, which no
  single source can show on its own.
- **The five things that make it worth using:**
  1. **Pillar clusters** — the value is not the dots, it is which pillars *share*
     the same entities. That overlap is where the contests actually happen.
  2. **Colour = momentum, size = scale** — instantly separates "big but stalling"
     from "small but accelerating".
  3. **A time slider** — drag through the last 7 days and watch clusters form.
     This is the single best interaction: it turns a static map into the actual
     argument.
  4. **Path tracing** — click a trademark and watch the packages, repos and papers
     behind it light up.
  5. **Line style = relationship type** — otherwise the lines are just spaghetti.
- **Why 2D and not 3D:** most 3D graph views look impressive and answer nothing.
  The dataset is small, so speed is not the problem — readability is. Spinning a
  graph in 3D makes it harder to read, not easier.
- **Built, and drawing real data:** 1,142 nodes and 2,796 relationships. It shows
  clusters rather than long paths at the moment — see §7.

### 4.3 Setup / Pillars

- **What it shows:** the five pillars and the search terms for each, editable.
- **What it answers:** "what is this app actually watching, and can I change it?"
- **Why it is useful:** the pillar list is the only thing that decides what gets
  collected. Editing it here means not editing a workflow file.

### 4.4 Logs

- **What it shows:** what ran, when, what failed, and what the gate decided.
- **Why it is useful:** when a chart looks wrong, this is where you find out
  whether the data was bad or the chart was.

### 4.5 Ask + Lineage

- **What it shows:** a plain-English question box, plus a card showing where the
  answer came from.
- **What it answers:** questions like "which pillar grew fastest last quarter"
  or "what papers are behind the top AI memory packages."
- **Why it is useful:** the lineage card (**lineage** — the recorded path from
  answer back to source) means every number can be traced to the file it came
  from. No unexplained figures.

### The prediction layer

- **Trend, not forecast.** The app does not claim to predict the future. It
  measures the *rate of change* across seven independent signals and shows where
  they agree.
- **Agreement is the signal.** When research, code, adoption, and money all move
  the same direction, the trend is real. When they disagree, the pillar is
  either early or fading — and the divergence chart tells you which.
- **The lead time is the product.** Trademarks are filed one to three years
  before a product ships. Papers appear months before code. By watching all seven
  at once, the app shows you a technology's trajectory while there is still time
  to act on it.

---

## 5. Where Things Live

| Folder | What is in it |
|---|---|
| `data/` | The collected files, one folder per source. Local staging only. |
| `notebooks/silver/` | The Silver script — raw files to the `silver_nodes` table. |
| `notebooks/gold/` | The Gold script — Silver to daily totals. Not yet working. |
| `schemas/` | The table definitions — what columns exist and what type each is. |
| `n8n/` | A copy of the collection workflow, for reference. |
| `ui/` | The five screens. Scaffolded, not yet built. |
| `scripts/` | Small helper scripts, including a network check. |
| `archive/` | Superseded documents, kept for history. |

---

## 6. Words You Will See

| Term | Plain meaning |
|---|---|
| **API** | Application Programming Interface — how one program asks another for data |
| **arXiv** | A public archive of research papers posted before peer review |
| **Bronze / Silver / Gold** | Three stages of data refinement: raw, cleaned, summarised. Stages, not products |
| **cron** | A timer written as five numbers, e.g. `0 5 * * *` means 05:00 every day |
| **Databricks** | The cloud platform that stores and processes the data |
| **Delta Lake** | The table format that makes a folder of files behave like a real table — safe writes, schema enforcement, undo |
| **Delta table** | A table stored as files in cloud storage, with a change log so it can be updated safely |
| **edge** | A relationship between two things in the data |
| **Genie** | A Databricks tool that answers questions typed in plain English |
| **HITL** | Human In The Loop — a person approves a decision the software will not make alone |
| **Hugging Face** | A public library of downloadable AI models |
| **JSON** | JavaScript Object Notation — a text format for structured data |
| **JSONL** | JSON Lines — one complete JSON record per line of a text file |
| **Lakehouse** | An architecture: cheap file storage with warehouse-style table features on top. Not a product |
| **Lakebase** | A managed Postgres database, used for fast lookups by the app |
| **node** | A single thing in the data — a paper, repo, package, model, or trademark |
| **node_id** | The permanent identifier for a node. Package IDs carry their registry, e.g. `pypi:minio` vs `npm:minio` |
| **node_key** | A short fingerprint of `node_id` + pillar, used to spot duplicate observations |
| **npm** | The package registry for JavaScript — the equivalent of PyPI for JavaScript |
| **OpenAlex** | A free index of scholarly papers and citations |
| **parse** | Convert data from one layout into another |
| **Parquet** | A compressed columnar file format. Delta tables store their data as Parquet underneath — you never open one directly |
| **partition** | A physical subdivision of a table. Silver splits by day, so each day's rows are stored together |
| **PAT** | Personal Access Token — a password-like string that grants program access |
| **pgvector** | An add-on that lets Postgres store and search vectors (numeric fingerprints used for similarity search) |
| **pillar** | One of the five technology themes this app tracks |
| **PyPI** | Python Package Index — the public catalogue of installable Python software |
| **TDXF** | Trademark Daily XML Files — the USPTO's bulk trademark data release |
| **Unity Catalog** | Databricks' system for naming and controlling access to data |
| **USPTO** | United States Patent and Trademark Office |
| **validation** | Checking that data is complete and correctly shaped before using it |
| **grain** | What one row represents. Silver's grain is "one thing, on one pillar, on one day" |
| **Volume** | A shared folder inside Databricks' cloud storage |

---

## 7. Current State

- ✅ Collection works. All seven sources return real data.
- ✅ Validation and the human approval step are wired.
- ✅ Files upload to cloud storage automatically.
- ✅ **Silver works.** `momentum.momentum.silver_nodes` holds 2,432 rows across
  seven sources. Re-running it produces the same result.
- ✅ **Gold works.** Two tables: `gold_level` (how big each thing is, ~3,900 rows)
  and `gold_volume` (how many things appeared per day, 63 rows).
- ✅ **npm has real daily history.** npm's API returns a week of per-day download
  counts, so npm momentum works today — back to 8 Nov 2026. Every other source
  only has history from 11 Nov, when Silver started.
- ✅ **Edges exist.** `silver_edges` holds 2,796 relationships in five kinds:
  2,406 *membership* (this belongs to this pillar), 371 *citation* (this paper
  cites that paper), 13 *dependency* (this package needs that package), 5
  *repo→package* (this repo publishes that package), and 1 trademark→company.
- ✅ **Citations are real.** The most-cited paper inside the corpus is AlexNet,
  cited by 40 of the papers we track. That is the graph telling a story.
- ✅ **The UI is built.** Four tabs — Momentum Board, Graph Explorer, Setup, Logs.
  It reads a snapshot of the warehouse and renders real data.
- ✅ **USPTO now finds real trademarks.** The old search terms were research
  jargon that never appears in trademark paperwork, so the leg was silently
  collecting nothing. It now has its own vocabulary and matches hundreds of
  filings a day.
- ✅ **A quiet day is no longer an error.** A thin weekend trademark file used to
  stop the run dead. Now it is simply recorded as a quiet day.
- ⏳ **The daily timer is switched off.** Runs are started by hand while the UI is
  being tested. Turning it back on is a one-click change.
- ⏳ **The failure path has not been tested.** Nobody has yet forced a broken leg
  and confirmed the Slack approval message actually arrives. Until that is done,
  treat error handling as written-but-unproven.
- ⏳ **Paper→model links are still missing.** Connecting a paper to the Hugging
  Face model it produced needs one extra call *per model* (~543 per run), because
  the arXiv ID sits in the model's card rather than the list response. Deferred
  as a cost/benefit call, not a blocker.
- ⏳ **Next: put the UI on Databricks itself.** Instead of a snapshot file, the app
  can query the warehouse directly and live inside Databricks as its own app.
  See [`HANDOVER.md`](./HANDOVER.md).

The graph can now be drawn, but it will show clusters rather than paths until
richer relationships are collected.

### Poking at it yourself in Databricks

If you want to look at the data by hand, the three things worth opening are:

| Where | What to do there |
|---|---|
| **Catalog** → `momentum` → `momentum` → `silver_nodes` | Browse the table. The **Sample Data** tab shows rows without writing any SQL. |
| **SQL Editor** | Run `SELECT source, count(*) FROM momentum.momentum.silver_nodes GROUP BY source` to see the row count per source. |
| **Workspace** → your folder | Upload `notebooks/silver/silver_nodes.py` here to run it. It rebuilds the table from scratch each time, so it is safe to re-run. |

Two things that will trip you up:

- **The name needs three parts.** `momentum.momentum.silver_nodes` — catalog
  `momentum`, schema `momentum`, table `silver_nodes`. Writing just
  `momentum.silver_nodes` fails, because Databricks reads that as catalog
  `momentum` plus a schema that does not exist.
- **The Volume is flat.** Files sit directly in `landing/<source>/`, not in a
  `raw/` subfolder. The old docs mentioned `raw/` — that folder does not exist.
