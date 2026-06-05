# Recruitment intake — agent task list

Self-contained tasks that turn JobOps into the **system of record for inbound recruitment** (recruiters reaching out via LinkedIn, email, calls, notes) — not just outbound job search. Separate body of work from `AGENT_TASKS.md` (T1–T8, which is search/skill-gap/OE). Renumbered `R1..R5` so the two batches never collide.

## Ground rules

**Inherit all ground rules from `AGENT_TASKS.md`** (branch-per-run, commit-per-task, skip-on-blocker, `REPORT.md`, verify-before-commit, coding conventions: `logger` from `@infra/logger`, `AppError` from `@infra/errors`, API contract `{ ok, data, meta:{requestId} }` / `{ ok:false, error:{code,message}, meta }`, path aliases, Vitest colocated `*.test.ts`, integration tests hit real SQLite). Use a branch like `agent/recruitment-$(date +%Y%m%d)`.

## Locked decisions (do not relitigate)

- **System of record = JobOps SQLite.** The homelab Postgres `brain-db` is NOT touched. Recruitment is its own bounded context inside this app.
- **LLM = reuse JobOps' own provider** via `services/llm` (same plumbing as jobChat / `ghostwriter` / `job-brief`). Do **not** add a separate Anthropic/OpenAI client. Whatever the app is configured with (Codex app-server provider) is what the worker uses.
- **Single tenant / single user.** `tenant_default`, one human. Every task in `tasks` is "mine" — no assignee column needed.
- **Capture is dual-channel**, both POST to `POST /api/ingest`: (1) a Telegram "JobOps Inbox" bot, (2) a watched folder on the PC. Hidock call transcripts arrive as `.txt` dropped into that folder (transcription happens off-repo — see Out-of-repo appendix).
- **Action points** live in the existing `tasks` table, surfaced by a new **"Your move"** page + a **daily Telegram nudge** driven by an **in-app node-cron** (the container runs 24/7 on CT104; the PC does not).
- **Tech-interview study-topics** extracted from transcripts go into a **staging table, rekru-import-ready**. `rekru` itself is deferred and owned separately — do not build a rekru importer here.
- **Notion** = one-shot salvage migration (R5), then sunset. Do not write back to Notion.
- **`jobs.jobUrl` is NOT NULL + unique on `(tenantId, jobUrl)`.** Recruiter intake usually has no URL → mint a synthetic stable URL `recruitment://<companySlug>-<positionSlug>` so the unique index doubles as the dedup key.

## Reuse map (read these before writing new code)

| Need | Existing code |
|---|---|
| Create a job from a non-crawler source | `services/manualJob.ts` |
| NEW-vs-UPDATE / duplicate detection | `services/applied-duplicate-matching.ts` |
| Call the configured LLM | `services/llm/`, `services/llm-service.ts`, `services/modelSelection.ts`, `services/ai-resilience.ts` |
| Stage transitions + tasks | `services/applicationTracking.ts`, tables `stage_events`, `tasks` |
| Interview prep extraction | `services/interview-prep.ts`, table `interviews` |
| Company summary / brief | `services/job-brief.ts` |
| Polish output | `services/output-language.ts` |
| Enum sources | `APPLICATION_STAGES`, `APPLICATION_TASK_TYPES`, `APPLICATION_OUTCOMES`, `INTERVIEW_TYPES`, `INTERVIEW_OUTCOMES` (grep their definitions; validate every extracted enum against them) |

---

## Task order

`R1 → R2 → (R3 ∥ R4)`; `R5` is independent (any time). The live wiring for R4 needs the Out-of-repo ops (O1/O3) done first, but the **code** in R4 is testable without them.

### R1 — `raw_intake` table + `interview_study_topics` staging + `POST /api/ingest`

**Files.**
- `orchestrator/src/server/db/schema.ts` — two new tables.
- New Drizzle migration in `orchestrator/src/server/db/`.
- `orchestrator/src/server/api/routes/ingest/index.ts` (NEW route) + register in `api/routes.ts`.
- Colocated route test.

**Plan.**
1. `rawIntake` table: `id`, `tenantId` (default `tenant_default`), `source` enum (`telegram`,`folder`,`hidock`,`notion_migration`,`manual`), `kind` enum (`linkedin_msg`,`recruiter_email`,`call_transcript`,`job_post`,`note`), `rawText` (text, notNull), `contentHash` (text, notNull) with **unique index** on `(tenantId, contentHash)`, `meta` (`{ mode: "json" }`), `status` enum (`pending`,`processed`,`error`,`needs_review`) default `pending`, `errorMessage` (nullable), `jobId` (nullable fk → `jobs.id`), `createdAt`, `processedAt` (nullable).
2. `interviewStudyTopics` staging table: `id`, `tenantId`, `applicationId` (fk → `jobs.id`), `interviewId` (nullable fk → `interviews.id`), `company`, `role`, `topicsJson` (json), `hesitationsJson` (json), `conceptsJson` (json), `priority` enum (`high`,`medium`,`low`), `exportedToRekru` (boolean, default false), `createdAt`.
3. `POST /api/ingest` accepts `{ source, kind, text, meta? }`. Compute `contentHash = sha256(normalize(text))`. Insert `rawIntake`; on unique-hash conflict, return the existing row id with `deduped: true` instead of erroring. Response `{ ok:true, data:{ intakeId, deduped }, meta }`. Do **not** process inline — leave `status:'pending'` for R2 (decouple capture from extraction).
4. Validate `source`/`kind` against the enums; reject unknown with `AppError` 400.

**Acceptance.**
- POST raw text → `rawIntake` row `status:'pending'`, `deduped:false`.
- Identical text again → same `intakeId`, `deduped:true`, no second row.
- Migration applies cleanly on a fresh DB and is reversible.

**Verification.** Route test + migration test against fresh DB; `check:types`.

---

### R2 — Ingest worker: extract → classify → upsert

**Depends on:** R1.

**Files.**
- `orchestrator/src/server/services/recruitment-intake.ts` (NEW) — `processIntake(intakeId): Promise<IntakeResult>`.
- `orchestrator/src/server/services/recruitment-intake.test.ts` (NEW) — fixture-driven.
- A trigger: extend the existing scheduler/bootstrap (the one that already runs watchlist checks) to drain `rawIntake where status='pending'`, OR call `processIntake` from the end of `POST /api/ingest`. Prefer a small drain loop so capture stays fast.

**Plan.**
1. **Extract.** Load the `rawIntake` row. Call the configured LLM through `services/llm` with a Zod schema for the field set below. **Never invent** — missing info stays blank. Validate every enum field against the real enum constants; on mismatch, blank it and note in `meta`.
   - Required: position (title), company, stage (`APPLICATION_STAGES`), contactDate (ISO; if absent use `rawIntake.createdAt` and flag it), initiatedBy (`me`|`recruiter`).
   - Important: contactName, agency (pośrednik), contractType (`B2B`|`UoP`|`Zlecenie`), rate (number PLN), rateType, salaryRangeText (widełki), workModel (`Remote`|`Hybrid`|`On-site`), location, techStack (string[]), source, jobPostUrl, priority.
   - ADHD: nextAction (string), nextActionDue (ISO), flags (🟢/🔴 string), companyNotes (2–3 sentences via `job-brief` style), notes.
   - PL output via `services/output-language.ts`.
2. **Classify NEW vs UPDATE.** Normalize company+position → synthetic `recruitment://<companySlug>-<positionSlug>` url. Use `services/applied-duplicate-matching.ts` to find an existing `job`. If match confidence is **below threshold**, set `rawIntake.status='needs_review'` and stop (do **not** auto-create — a duplicate application is worse than a deferred one). Surface needs-review rows in R3's page.
3. **Upsert.**
   - NEW → create via the `manualJob` path with synthetic source (`linkedin`/`recruiter`/…) and the synthetic `jobUrl`. Set `suitabilityScore`/`suitabilityReason` from the recruitment profile (see step 5).
   - UPDATE → patch only newly-known fields; **append** a `jobNote` (never overwrite existing notes).
   - Write a `stageEvent` for the detected stage (via `applicationTracking`). Create `tasks` for `nextAction` (with `dueDate` = `nextActionDue`). Create an `interviews` row if a future interview is scheduled.
4. **Transcript path.** If `kind='call_transcript'` and the LLM classifies it as a tech/HR interview: also extract questions asked, where the candidate hesitated, and technical concepts to study → insert one `interviewStudyTopics` row (rekru-ready; `priority` from frequency/weight). If the call is clearly **not** recruitment, mark `rawIntake.status='processed'` with no job created (Hidock records everything; private calls must drop out here).
5. **Scoring profile.** Read a recruitment profile from app config/env (floor rate, preferred stack, remote preference, red-flag list) — single source for `priority`/`suitabilityScore`, not ad-hoc prompt heuristics. Provide a sane default profile object in the repo; document the env override.
6. **Idempotency.** On success set `status='processed'`, `processedAt`, link `jobId`. On failure `status='error'` + `errorMessage`. Re-running `processIntake` on a processed row is a no-op.

**Acceptance.**
- Fixtures for LinkedIn message, recruiter email, and a tech-interview transcript each produce the correct `job` + `tasks` + (transcript) `interviews` + `interviewStudyTopics`.
- All enum fields are valid or blank — never a hallucinated enum.
- Re-processing the same intake creates no duplicate rows.
- A low-confidence company/position match yields `needs_review`, not a second job.

**Verification.** Service tests (mock `services/llm` with canned JSON — do not hit a real model in CI); migration unaffected; `check:types`.

---

### R3 — "Your move" page + daily Telegram nudge (node-cron)

**Depends on:** R2 (consumes `tasks` + `needs_review`).

**Files.**
- `orchestrator/src/server/repositories/jobs.ts` (or a new `tasks` repo) — `getYourMove(): { overdue, today, soon, needsReview }`.
- `orchestrator/src/server/api/routes/jobs/...` — `GET /api/tasks/your-move`.
- `orchestrator/src/server/services/nudge-telegram.ts` (NEW) — formats + sends.
- Scheduler bootstrap — register a daily node-cron job calling the nudge (config hour via env, default 08:00 Europe/Warsaw).
- Client: `orchestrator/src/client/pages/YourMovePage.tsx`, route in `App.tsx`, nav entry, `client/api`, `client/lib/queryKeys.ts`.

**Plan.**
1. **Repo.** Open tasks (`isCompleted=false`) joined to `jobs`, ordered by `dueDate`; bucket overdue / today / next 7 days; plus `rawIntake` rows with `status='needs_review'`.
2. **Endpoint.** Standard contract; tenant-scoped.
3. **Page.** Dedicated screen: overdue (red) → today → soon, each task showing company · position · action · due, with quick **Complete** and **Snooze (+1d/+3d)**. A "Needs review" section lists ambiguous intakes with a link to resolve. This is the ADHD surface — action points must be unmissable, not buried in cards.
4. **Nudge.** `nudge-telegram.ts` reads `getYourMove`, formats overdue+today into a short message, sends via Telegram Bot API (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` from env). Use real unicode (no `\uXXXX`). Make time source and `fetch` injectable for tests. node-cron registered once at server start; skip send if the bucket is empty.

**Acceptance.**
- A task with a past `dueDate` appears under "overdue" on the page and in the nudge payload.
- Complete/Snooze mutate the task and refetch.
- Nudge unit test: seeded overdue+today tasks → exactly one formatted message to a mocked sender; empty buckets → no send.

**Verification.** Repo + API + nudge unit tests; component test for the page; `check:types`; `build:client`.

---

### R4 — Capture wiring (repo side): Telegram webhook + folder watcher

**Depends on:** R1 (`/api/ingest`).

**Files.**
- `orchestrator/src/server/api/routes/ingest/telegram.ts` (NEW) — `POST /api/ingest/telegram`.
- `scripts/intake-folder-watcher.mjs` (NEW) — standalone PC-side watcher.
- Colocated webhook test.

**Plan.**
1. **Telegram webhook.** Verify the secret header (`X-Telegram-Bot-Api-Secret-Token`). Parse the update: plain message, forwarded message, or caption. Map to an `/api/ingest` call `{ source:'telegram', kind }` where `kind` is inferred from content (URL-only → `job_post`; otherwise `note`/`linkedin_msg`). Reply 200 fast. Reuse the hard-won Brain Inbox lessons: talk HTTP, real unicode, don't block on downstream.
2. **Folder watcher** (`scripts/intake-folder-watcher.mjs`, runs on the PC via `node`/Task Scheduler): watch `INTAKE_DIR`, debounce until a file is size-stable, read it, `POST {JOBOPS_URL}/api/ingest { source: 'folder'|'hidock', kind }` (`.txt` transcripts from Hidock → `source:'hidock'`, `kind:'call_transcript'`). On 2xx rename `DONE_<name>`; on failure rename `ERR_<name>` — rename only after the response, never before.

**Acceptance.**
- A synthetic Telegram update with text → one `rawIntake` row via the real ingest path.
- Dropping a file into a temp `INTAKE_DIR` → POST fired, file renamed `DONE_`; a forced-failure target renames `ERR_`.

**Verification.** Webhook route test; a small unit test for the watcher's classify/rename logic (mock fetch + fs); `check:types`.

---

### R5 — Notion salvage migration (one-shot)

**Independent.**

**Files.**
- `scripts/migrate-notion-applications.mjs` (NEW).

**Plan.**
1. Read the Notion "Job Applications" DB via API — database `cea1eeeda656456893ae48a2f0828843`, data source `7ff68ce7-116e-4f52-86f3-b2489dcbeacb` (token from env). Always write a `notion-backup-<date>.csv` first.
2. For each page, serialize the salvageable fields (company, position, stage, contact name, dates) and `POST /api/ingest { source:'notion_migration', kind:'note', text:<serialized>, meta:{ archived:true, notionId } }` — let R2 do the upsert/dedup. Migrated jobs land as archived/stale (don't pollute the active board).
3. `--dry-run` prints the row count + writes the CSV without POSTing. Idempotent: re-run dedups on `contentHash`.

**Acceptance.** Dry-run reports N rows + CSV exists; real run yields N archived jobs; second real run creates zero new rows.

**Verification.** Script runs end-to-end against a seeded local ingest endpoint; `check:types` if any shared code is touched.

---

## Out-of-repo ops (NOT for the coding agent — for the human / a homelab session)

These need the PC, the device, BotFather, Cloudflare, or CT104 deploy — they can't be done by an in-repo agent.

- **O1 — Telegram "JobOps Inbox" bot.** Create a **new** bot via BotFather (separate token from the Brain Inbox bot — shared webhooks conflict, learned the hard way). Add a Cloudflare Tunnel Public Hostname route to JobOps. `setWebhook` → `https://<host>/api/ingest/telegram` with a secret token. Put `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / webhook secret into JobOps env.
- **O2 — Hidock automation (PC).** Fully local, headless, no HiDock web app / cloud. Chain (all on the PC where the device is plugged):
  1. **Pull:** `sgeraldes/hidock-next` → `apps/desktop/bulk_download.py --output-dir <DIR>` pulls all recordings over USB via libusb (device `VID 10d6 / PID b00d`, "Jensen" protocol, class `HiDockJensen`, has retries) → `*.hda`.
  2. **Decode:** reuse `apps/desktop/src/hta_converter.py` → `HTAConverter().convert_hta_to_wav(hda, wav)` (proprietary `.hda` decoded locally; `convert_all_hda.py` is the batch example but hardcodes a path — write a thin wrapper).
  3. **Transcribe:** POST each wav to the live whisper-server `http://192.168.100.7:9000/v1/audio/transcriptions` (`model=Systran/faster-whisper-large-v3`, `language=pl`).
  4. **Hand off:** write the transcript `.txt` into `INTAKE_DIR` → folder watcher (R4) → `/api/ingest` (`source:'hidock'`, `kind:'call_transcript'`).
  Deps: Python + `pyusb` + bundled `libusb-1.0.dll` + a vendored slice of hidock-next `src/` (or clone the repo). Schedule via Windows Task Scheduler (periodic or on device-connect). **One-time, needs the physical device:** confirm `bulk_download.py` enumerates the unit at `10d6:b00d` and `HTAConverter` decodes this firmware's `.hda`. Everything downstream is already proven. **whisper-server is DONE** (live, smoke-tested 2026-06-05; see `brain-memory/STATE/homelab.md`).
- **O3 — Deploy.** Build/ship the JobOps image to CT104 via the Forgejo `curl | bash` flow. Run the new Drizzle migrations. Set the recruitment profile + Telegram env. Smoke: paste to Telegram → card + task → shows in "Your move".
- **Cross-cutting — brain-memory.** After MVP (R1–R4 green), record in `E:\repo\brain-memory`: `DECISIONS/` (JobOps = SoR for recruitment; Notion sunset; study-topics → rekru staging), update `STATE/second-brain.md` + `STATE/work.md`, add/extend a `PROJECTS/` entry. Per `CONVENTIONS.md` — otherwise drift-sentinel will flag world ≠ STATE.

## MVP definition

R1 + R2 + R3 + R4 green = paste/forward a recruiter message (or drop a Hidock transcript) → a correctly-staged JobOps card with the next action as a `tasks` row → it shows on "Your move" and arrives as a daily Telegram nudge. Hidock auto-pull (O2) and Notion salvage (R5) are fast-follow. rekru is a separate track on another owner.
