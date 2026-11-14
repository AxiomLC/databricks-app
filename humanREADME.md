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
  data from six public sources, checks it for damage, and files it away.
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

## 2. Why These Six Sources

Each source is a different *kind of evidence*. None of them alone tells you
where a technology is going. Together they form a timeline: research first,
then code, then adoption, then money.

| Source | What it is | What it tells you | Time lag |
|---|---|---|---|
| **arXiv** | A public archive of research preprints (papers posted before peer review) | What researchers are excited about *right now* | Days |
| **GitHub** | The main website where programmers publish and share code | Whether developers are actually building with it | Weeks |
| **Hugging Face** | A public library of downloadable AI models | Whether the models exist and are being downloaded | Weeks to months |
| **PyPI** | The Python Package Index — the public catalogue of installable Python software | Whether real products are installing it in production | Months |
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

A pillar where all six are rising is a genuine wave. A pillar where papers are
rising but downloads are flat is hype. A pillar where trademarks are being filed
but nothing else is moving is a company bet you cannot see yet.

---

## 3. How It Works — Numbered Flow

### Flow A — Daily collection (runs automatically at 05:00)

1. **A timer fires.** A scheduled job (called a **cron** — a timer written as
   five numbers meaning minute, hour, day, month, weekday) starts the run.
2. **The keyword list is loaded.** One central list holds the five pillars and
   the search terms for each. This is the only place to change what gets
   searched.
3. **Five collectors run in parallel.** One each for arXiv, GitHub, Hugging
   Face, PyPI, and USPTO. Each asks its source for the newest matching records.
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
   by source.
2. **Bronze stage.** The raw files are registered as-is. Nothing is cleaned.
   This is the permanent record of what arrived.
3. **Silver stage.** A notebook (a script that runs inside Databricks) reads the
   raw files, removes duplicates, standardises names, and splits the data into
   two shapes: **nodes** (individual things — a paper, a repo, a package, a
   model, a trademark) and **edges** (relationships between those things — this
   paper led to that repo, this repo publishes that package).
4. **Gold stage.** A second notebook aggregates everything into daily totals per
   pillar per source — the numbers that feed the charts.
5. **The app reads Gold.** The dashboard queries the summary tables, not the raw
   files, so it stays fast.

---

## 4. What You Get At The End

Three screens, all reading from the same Gold summary tables.

### 4.1 Momentum Board

- **What it shows:** one line per pillar, plotted over time, for each kind of
  evidence — paper volume, repo stars, model downloads, package installs,
  citations, trademark filings.
- **What it answers:** which pillar is accelerating, which has flattened, and
  which is rising in one signal but not the others.
- **The key chart:** a "signal divergence" view. When paper volume rises while
  package downloads fall, that pillar is losing momentum despite looking busy.
- **Why it is useful:** it converts six unrelated numbers into one comparable
  shape, so you can rank the five pillars against each other.

### 4.2 Graph Explorer

- **What it shows:** a three-dimensional map where each dot is a paper, repo,
  package, model, or trademark, and each line is a real connection between them.
- **What it answers:** how an idea travels. Follow a paper to the repo that
  implemented it, to the package that shipped it, to the trademark that
  commercialised it.
- **Why it is useful:** it exposes the path from research to revenue, which no
  single source can show on its own.

### 4.3 Ask + Lineage

- **What it shows:** a plain-English question box, plus a card showing where the
  answer came from.
- **What it answers:** questions like "which pillar grew fastest last quarter"
  or "what papers are behind the top AI memory packages."
- **Why it is useful:** the lineage card (**lineage** — the recorded path from
  answer back to source) means every number can be traced to the file it came
  from. No unexplained figures.

### The prediction layer

- **Trend, not forecast.** The app does not claim to predict the future. It
  measures the *rate of change* across six independent signals and shows where
  they agree.
- **Agreement is the signal.** When research, code, adoption, and money all move
  the same direction, the trend is real. When they disagree, the pillar is
  either early or fading — and the divergence chart tells you which.
- **The lead time is the product.** Trademarks are filed one to three years
  before a product ships. Papers appear months before code. By watching all six
  at once, the app shows you a technology's trajectory while there is still time
  to act on it.

---

## 5. Where Things Live

| Folder | What is in it |
|---|---|
| `data/` | The collected files, one folder per source. Local staging only. |
| `notebooks/` | The Silver and Gold scripts that run inside Databricks. |
| `schemas/` | The table definitions — what columns exist and what type each is. |
| `n8n/` | A copy of the collection workflow, for reference. |
| `ui/` | The three screens. Scaffolded, not yet built. |
| `scripts/` | Small helper scripts, including a network check. |
| `archive/` | Superseded documents, kept for history. |

---

## 6. Words You Will See

| Term | Plain meaning |
|---|---|
| **API** | Application Programming Interface — how one program asks another for data |
| **arXiv** | A public archive of research papers posted before peer review |
| **Bronze / Silver / Gold** | Three stages of data refinement: raw, cleaned, summarised |
| **cron** | A timer written as five numbers, e.g. `0 5 * * *` means 05:00 every day |
| **Databricks** | The cloud platform that stores and processes the data |
| **Delta table** | A table stored as files in cloud storage, with a change log so it can be updated safely |
| **edge** | A relationship between two things in the data |
| **Genie** | A Databricks tool that answers questions typed in plain English |
| **HITL** | Human In The Loop — a person approves a decision the software will not make alone |
| **Hugging Face** | A public library of downloadable AI models |
| **JSON** | JavaScript Object Notation — a text format for structured data |
| **JSONL** | JSON Lines — one complete JSON record per line of a text file |
| **Lakebase** | A managed Postgres database, used for fast lookups by the app |
| **node** | A single thing in the data — a paper, repo, package, model, or trademark |
| **OpenAlex** | A free index of scholarly papers and citations |
| **parse** | Convert data from one layout into another |
| **PAT** | Personal Access Token — a password-like string that grants program access |
| **pgvector** | An add-on that lets Postgres store and search vectors (numeric fingerprints used for similarity search) |
| **pillar** | One of the five technology themes this app tracks |
| **PyPI** | Python Package Index — the public catalogue of installable Python software |
| **TDXF** | Trademark Daily XML Files — the USPTO's bulk trademark data release |
| **Unity Catalog** | Databricks' system for naming and controlling access to data |
| **USPTO** | United States Patent and Trademark Office |
| **validation** | Checking that data is complete and correctly shaped before using it |
| **Volume** | A shared folder inside Databricks' cloud storage |

---

## 7. Current State

- ✅ Collection works. All six sources return real data.
- ✅ Validation and the human approval step are wired.
- ✅ Files upload to cloud storage automatically.
- ⏳ The Silver and Gold scripts exist but are not yet pointed at the live files.
- ⏳ The three screens are scaffolded but not built.
- ⏳ The USPTO historical archive is only partially downloaded (one of 177 parts).

Until Silver and Gold run against real data, there are no charts. That is the
next milestone — see [`HANDOVER.md`](./HANDOVER.md).
