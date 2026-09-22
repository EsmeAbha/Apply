# PhD Application Intelligence Assistant

Find open, well-funded PhD opportunities, check what each one requires and by when using the **official source**, prepare your documents, and keep monitoring each opportunity until you apply.

It works as a **dashboard**, a **REST API** and a **Chrome extension (Manifest V3)**.

> **Core principles:** official sources first · every fact carries evidence (URL, verbatim snippet, access date, certainty) · missing information is shown as **UNKNOWN / NEEDS VERIFICATION**, never guessed · changes to official pages are recorded for your review, never silently applied · **the app never submits applications, sends emails or pays fees**.

---

## 1. What you can do

| Area | What the app does |
|---|---|
| **Analyse a page** | Paste an official URL, or click *Analyze this opportunity* in the extension. You get a one-minute answer: **WHERE? WHAT? DEADLINE? FUNDING? FEE? IELTS? DOCUMENTS? SOURCE? WHAT NEXT?** Each fact has a certainty badge (VERIFIED / LIKELY / POSSIBLE / CONFLICTING / UNKNOWN) and a *source* popover that quotes the page. |
| **Deadlines** | Application, funding, scholarship, supervisor-contact and opening dates are stored **separately**, together with multiple rounds, rolling admission, time and timezone. A date with no year, or an ambiguous `03/04/2027`, is flagged rather than guessed. Deadlines are grouped by urgency (critical ≤3 days, urgent ≤7, soon ≤14, upcoming ≤30, later) in your own timezone. There is a calendar view. |
| **Funding** | Fully funded / partially funded / salaried position / scholarship available / competitive / self-funded / unknown. It records tuition coverage, stipend, salary, duration, guaranteed vs competitive, and extra benefits only when they are stated. A bare mention of "scholarship" is **never** treated as full funding. |
| **Application cost** | Free application, fee amount (original currency), whether a fee waiver exists and who qualifies. It also finds other mandatory costs (uni-assist, credential evaluation, certified copies, courier). An application is not called "free" when another mandatory cost exists. |
| **IELTS / English** | Required at application, can be submitted later (after admission or before enrolment), not required, waiver possible (English-medium degree, nationality, discretion), stage unclear, or conflicting. It extracts minimum overall and per-section scores for IELTS, TOEFL, Duolingo and PTE. It never assumes you qualify for a waiver. |
| **Documents** | Required, optional, conditional or not required, with page and word limits, file format and size, number of referees, and instructions. Each links back to its source. |
| **Discovery** | Seed pages and RSS feeds for the crawler (it respects robots.txt, applies per-site rate limits and re-runs daily). Search-strategy links you open in your own browser. An optional Brave Search API. Third-party listings are kept as *leads* only. |
| **Change detection** | Saved opportunities are re-checked every day. Differences appear as **CHANGE DETECTED — Old → New**, with the source and a timestamp. You accept or dismiss each change. |
| **Conflicts** | When two sources disagree (for example the department page vs the graduate admissions page), both are shown side by side as **CONFLICTING — VERIFY MANUALLY**. |
| **Matching** | A factual comparison of research alignment, degree requirement (quoted), skills, publications, experience, English, funding, fee and deadline. **It is not a prediction of admission.** |
| **Document vault** | Uploads are encrypted with AES-256-GCM. Every upload is a new version (`CV_v1`, `CV_PhD_NLP_v2`), and originals are never overwritten. CV analysis *proposes* profile entries; you import only what is correct. |
| **Tailored drafts** | SOP (tailored from **your** master SOP, with a word-level comparison against the master and a reason for each change), cover letter (academic, research-focused, concise or formal), research-proposal skeleton, and supervisor emails. Gaps are filled with `[BRACKETED PLACEHOLDERS]`. A fabrication check flags names, numbers, emails and links that are not in your verified profile or the source page. |
| **Supervisors** | Finds academics on official staff pages. It keeps only e-mails published on the university's own domain and ranks academics by shared research areas. |
| **Applications** | Kanban pipeline with drag and drop, an application package per opportunity, a readiness bar (document completion only), an *APPLY NOW* checklist, a **Final Review** page and a ZIP package download. You record the submission yourself after typing *I SUBMITTED THIS APPLICATION MYSELF*. |
| **Form assistant** | The extension highlights fields: green means a suggestion from your profile, red means answer it yourself (citizenship, date of birth, declarations, consent, disability or medical questions, criminal record, finances, passwords), amber means required but empty, blue means upload it yourself. It fills only the green fields, only when you click, and never clicks submit. |
| **Notifications** | In-app, browser (dashboard and extension) and optional email to yourself. Covers deadline reminders at 30/14/7/3/1 days (configurable), new matching opportunities, missing documents, IELTS verification, changes on official pages and failed crawls. |

---

## 2. Project structure

```
Apply/
├── package.json              # npm workspaces: server, web, extension
├── server/                   # Node.js + TypeScript API (Express 5, Prisma, SQLite)
│   ├── prisma/schema.prisma  # data model (22 entities)
│   ├── src/
│   │   ├── extraction/       # deterministic, evidence-backed extractors
│   │   │   ├── text.ts        HTML → segments with heading context, JSON-LD
│   │   │   ├── dates.ts       date parsing, ambiguity flags, urgency buckets, timezone days
│   │   │   ├── deadlines.ts   application/funding/scholarship/supervisor/opening/rounds/rolling
│   │   │   ├── funding.ts     category, tuition, stipend, salary, duration, benefits
│   │   │   ├── fees.ts        fee, waiver, other mandatory costs
│   │   │   ├── english.ts     IELTS/TOEFL/DET/PTE, stage, waivers, conflicts
│   │   │   ├── documents.ts   required documents with constraints
│   │   │   ├── meta.ts        university, department, country, position type, apply URL, supervisors
│   │   │   └── source.ts      official / portal / government / third-party classification, URL normalisation
│   │   ├── ai/               # provider-agnostic LLM layer (Anthropic implemented) + anti-hallucination guards
│   │   ├── crawler/          # polite fetcher (robots.txt, rate limits) + discovery jobs
│   │   ├── services/         # opportunities, change detection, matching, applications, vault, generation, notifications…
│   │   ├── routes/           # REST API
│   │   ├── scheduler.ts      # re-verification, notification scan, daily discovery
│   │   └── scripts/seedDemo.ts
│   └── test/                 # 64 tests + mock university pages (fixtures/)
├── web/                      # React 19 + TypeScript + Tailwind 4 dashboard (Vite)
└── extension/                # Chrome MV3 extension (React popup, on-demand content script)
    └── test/                 # form-assistant tests (jsdom)
```

## 3. Technology stack

- **Backend:** Node.js 22, TypeScript, Express 5, Zod, Prisma 6, SQLite (switch the Prisma provider to PostgreSQL for production), cheerio, chrono-node, unpdf (PDF text), mammoth (DOCX text), JSZip, nodemailer (optional).
- **Security:** scrypt password hashing, bearer sessions stored as SHA-256 hashes, AES-256-GCM file encryption, helmet, strict CORS, login throttling, no logging of request bodies.
- **Frontend:** React 19, React Router 7, Tailwind CSS 4, lucide icons.
- **Extension:** Manifest V3 using `activeTab`, `scripting`, `storage`, `alarms` and `notifications`. There are **no host permissions** and no content script that runs on every page.
- **AI (optional):** provider interface in `server/src/ai/provider.ts`, with an Anthropic Claude implementation (`@anthropic-ai/sdk`, default model `claude-opus-5`).
- **Tests:** Vitest, Supertest, jsdom.

## 4. Installation

Requirements: Node.js ≥ 20 (22 recommended) and npm.

```bash
git clone <this repo> && cd Apply
npm install
cp server/.env.example server/.env
# generate an encryption key for the document vault and paste it into APP_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run db:push -w server        # creates the SQLite database (server/prisma/dev.db)
```

## 5. Environment variables (`server/.env`)

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` (SQLite). For PostgreSQL, set `provider = "postgresql"` in `schema.prisma` and use a `postgres://` URL. |
| `APP_ENCRYPTION_KEY` | yes | 64 hex characters (32 bytes) used for vault encryption. **Back it up** — without it, uploaded files cannot be decrypted. |
| `PORT` | no | API port (default 4000). |
| `STORAGE_DIR` | no | Where the encrypted files are stored (default `./storage`). |
| `CORS_ORIGINS` | no | Dashboard origins allowed to call the API (default `http://localhost:5173`). The extension's `chrome-extension://` origin is always allowed. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | no | Enables AI assistance (see §9). |
| `SEARCH_PROVIDER=brave`, `BRAVE_API_KEY` | no | Enables automated web-search discovery. |
| `CRAWLER_USER_AGENT`, `CRAWLER_MIN_DELAY_MS` | no | Crawler identity and minimum delay per site (default 2000 ms). |
| `SCHEDULER_ENABLED`, `REVERIFY_INTERVAL_HOURS`, `NOTIFY_INTERVAL_MINUTES` | no | Background jobs (defaults: on, 24 h, 60 min). |
| `SMTP_URL`, `SMTP_FROM` | no | Optional email digest **to yourself**. |

## 6. Database

```bash
npm run db:push -w server     # create or update the schema
npx prisma studio --schema server/prisma/schema.prisma   # browse the data (optional)
```

Optional **demo data**: five **fictional** university pages (from `server/test/fixtures`) run through the real extraction pipeline and are labelled *DEMO DATA* in the UI:

```bash
npm run seed:demo -w server -- --email you@example.com            # existing account
npm run seed:demo -w server -- --email demo@example.com --password "at-least-10-chars"
```

## 7. Running

**Development** (API on :4000, dashboard with hot reload on :5173):

```bash
npm run dev
# open http://localhost:5173 and create an account
```

**Production-style** (the API also serves the built dashboard):

```bash
npm run build
npm start          # http://localhost:4000
```

## 8. Loading the Chrome extension

```bash
npm run build -w extension
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and choose `extension/dist`.
3. Click the toolbar icon, set the server URL (default `http://localhost:4000`) and sign in with your dashboard account.
4. On an official PhD page, click **Analyze this opportunity**, then **SAVE OPPORTUNITY**.
5. On an application form, click **Assist form** to open the review panel.

The extension reads a page only when you click one of its buttons. It stores a session token, never your password. It works in any Chromium browser (Chrome, Edge, Brave).

## 9. AI provider (optional)

Without AI, everything runs on deterministic rules and templates. To enable AI:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
```

How AI is kept honest:
- **Extraction:** AI only fills fields the rules left UNKNOWN. Each AI value must come with a quote that is found **verbatim** on the page, otherwise it is discarded (and you are told). "Fully funded" is also rejected unless the quote says it explicitly.
- **Drafting:** the prompt contains only your verified profile, your master text and the official facts. The output then goes through the same fabrication check as template drafts.
- Server-side refusal fallback is enabled (`fallbacks: "default"`), and a refusal is reported as an error rather than returning an empty draft.
- **Adding another provider:** implement `LLMProvider` in `server/src/ai/` and register it in `getProvider()`.

## 10. Tests and checks

```bash
npm test             # server (64) + extension (5) tests
npm run typecheck    # server, web, extension
npm run check        # both
```

The tests use mock university pages and a local mock website. They cover:
- deadline, funding, fee, IELTS and document extraction
- source classification and evidence
- deduplication, multi-source conflicts and change detection
- crawl failures and robots.txt
- document versioning and encryption at rest
- CV proposals
- application package and submission confirmation
- SOP tailoring and the fabrication check
- supervisor discovery
- notification scheduling (thresholds, timezone, idempotency)
- the discovery crawler
- form-field safety (sensitive fields are never filled and the form is never submitted)

No test depends on live websites.

## 11. Known limitations

- **Rule-based extraction covers common English phrasing.** Unusual layouts, non-English pages, PDF-only calls and heavily scripted portals may yield UNKNOWN. That is intentional (no guessing). Use *paste page source*, the extension, the optional AI pass, or *Correct a fact*, which is stored as "entered by you".
- **Scanned PDFs** have no text layer. OCR is not included, so CV analysis needs a text-based PDF, a DOCX, or pasted text.
- **Discovery without a search API** relies on seed pages and feeds you add, plus search links you open yourself. Search engines are not scraped.
- Country inferred from a domain is marked LIKELY. `.edu` is assumed to be the US.
- Structured-data (`JobPosting.validThrough`) deadlines are used only when the page text has none, and are marked for confirmation.
- The crawler does not run JavaScript, so single-page-app portals need the extension, which analyses the page you have open.
- Single-user oriented MVP: SQLite, in-memory login throttling and discovery-job state. Use PostgreSQL and a job queue for multi-user production.
- The dashboard stores its session token in `localStorage`. For production, move to httpOnly cookies with CSRF protection.
- Fabrication checks are heuristic: they flag unsupported names and numbers but cannot judge meaning. Always read drafts fully.

## 12. Recommended next steps

1. OCR for scanned documents (e.g. Tesseract) and PDF-only calls.
2. Per-country and per-university admission-rule knowledge bases (e.g. which countries' degrees are English-medium exempt at a given university), each with sources.
3. Headless-browser fetching for JavaScript-rendered official portals (still respecting robots.txt and terms).
4. Background job queue (BullMQ), PostgreSQL, httpOnly cookie auth, per-user rate limits.
5. More languages for extraction (German, Dutch, Swedish, French keywords).
6. Calendar export (ICS) and push notifications.
7. Citation-grounded AI extraction (document citations) for long pages; an evaluation set built from real, verified pages.
8. Firefox packaging (MV3 is largely compatible).

---

*This tool helps you research and prepare. The university's official information always takes precedence. Check critical facts (deadlines, funding, English requirements, eligibility) directly with the university before you rely on them.*
