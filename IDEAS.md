# IDEAS.md

Backlog of features captured for future implementation. Each section is self-contained — pick one up cold and read top-to-bottom.

## Implementation status (as of 2026-05-10)

### Skill Gap Analysis
- ✅ Feature 1 — Click-to-drill (by-skill panel)
- ✅ Feature 2 — Persistent skill ignore list (`skill_exclusions` table + UI)
- ✅ Feature 3 — User-skill detection fix (union across tailored jobs with min-frequency)
- ✅ Feature 4 — "Why is this here?" explainer (tooltip popover)

### Overemployment (OE) toolkit
- ✅ OE-1 — OE-fitness score + filter (`oeFitnessScore`, `oeFitnessReasons` columns; badge on JobPage + job list; filter)
- ✅ OE-2 — Red-flag scanner (`redFlags` column; chips on JobPage; `services/oe-redflags.ts`)
- ✅ OE-3 — Active-job registry (`active_employments` table; CRUD API; salary stack; `/my-employment` page)
- ✅ OE-4 — Stealth-apply hygiene (computed on-the-fly in `GET /api/jobs/:id`; shield icon in sidebar)
- ✅ OE-5 — Async-friendliness signal (`asyncScore`, `asyncSignals` columns; tag on JobPage)
- ✅ OE-6 — OE-friendly employer index (added to EmployerInsightsPage; avg OE fitness + red flag counts per employer)
- ✅ OE-7 — Workload estimator (`weeklyHoursEstimate`, `weeklyHoursReasons` columns; `~Nh/wk` tag on job cards)

### Polish job board extractors (missing descriptions)
- ✅ PD-1 — bulldogjob: description field added to GraphQL query
- ✅ PD-2 — justjoinit: detail-fetch pass added (concurrency 5, graceful degrade)
- ⏭ PD-3 — pracujpl: probed, no usable API without CF clearance — skip (documented)
- ⏭ PD-4 — theprotocol: probed, no usable API — skip (documented)

### Career Intelligence (CI)
- ✅ CI-1 — Career Pivot Finder (Jaccard-based clustering; `/pivot-finder` page)
- ✅ CI-2 — Skill Watchlist + market monitor (`skill_watchlist` table; `/watchlist` page; pipeline auto-checks after import; pending-match badge; 8-week sparkline)
- ⏳ CI-3 — Embedding-based semantic similarity (not started — complex, requires LLM API calls per job)
- ✅ CI-4 — Reverse search: skills → titles by demand (`/skill-demand` page)
- ✅ CI-5 — Skill co-occurrence map (integrated into SkillGapPage drill panel)
- ✅ CI-6 — Personal market monitor (`profile_market_snapshots` table; `npm run snapshots:market`; LineChart in MarketStatsPage with 30%+ drop/rise alert)

---

---

## Skill Gap Analysis improvements

Page: `orchestrator/src/client/pages/SkillGapPage.tsx`
Server aggregation: `orchestrator/src/server/repositories/jobs.ts` → `getSkillGapStats` (line ~1143)
API route: `orchestrator/src/server/api/routes/jobs/read.ts` (line ~186)

The page lists skills extracted from job postings (the `jobs.skills` CSV column) and classifies each as strength / gap / partial relative to the user's CV skills. Today it's a one-way wall: there's no way to investigate why a given skill is on the list, no way to suppress skills that are irrelevant to the user (e.g. Scala, Python, C#, Node.js, Vue.js, .Net, T-SQL, Golang showing up for a Java-focused user), and the user-skill detection is fragile.

### Feature 1 — Click-to-drill: skill → contributing jobs

**Problem.** A skill row shows count + match rate but no way to see which jobs caused it. User can't tell whether a "gap" is real signal or an artifact of one weird posting.

**Solution.** Clicking a row in the "All Skills Detail" table (and tags in the gap/strength callouts) opens a side panel or modal listing jobs that contained the skill: title, employer, suitability score, source, link to JobPage.

**Implementation notes.**
- Data already exists in `jobs.skills` (CSV) — no schema change.
- New endpoint, e.g. `GET /api/jobs/by-skill?skill=<name>&minScore=<n>` returning `{ jobs: Array<{ id, title, employer, score, source, discoveredAt }> }`.
- Match by case-insensitive equality on a CSV split, scoped by tenant + the same `minScore` filter the page is using, so the listed jobs are exactly the ones contributing to the count.
- Reuse the existing `getSkillGapStats` filtering predicate to keep numbers consistent.
- Client: new component (modal or right-side sheet). Sort by score desc. Each row links to `/jobs/:id`.

**Acceptance.**
- Click any skill in the detail table or callout → panel opens with N rows where N === the count shown on the row.
- Each row navigates to JobPage on click.
- Closing the panel returns to the previous filter/tab state.

### Feature 2 — Persistent per-skill ignore list (page-only scope)

**Problem.** Skills that are clearly outside the user's interest (Scala, .Net, T-SQL, etc.) keep reappearing on every pipeline run. No way to dismiss them.

**Decided scope.** **Page-only** — ignored skills are hidden from the SkillGapPage UI (callouts, detail table, KPI counts). They still exist in `jobs.skills` and continue to flow through scoring/tailoring unchanged. (Out of scope: feeding exclusions into the LLM scoring prompt — possible future expansion.)

**Implementation notes.**
- New table `skill_exclusions` scoped by `tenantId`:
  - `tenantId TEXT NOT NULL`
  - `skill TEXT NOT NULL` (stored lowercased for case-insensitive matching)
  - `excludedAt TEXT NOT NULL` (ISO timestamp)
  - `reason TEXT` (optional free-text, e.g. "not in my stack")
  - PK `(tenantId, skill)`
- Add Drizzle migration in `orchestrator/src/server/db/`.
- Repository: `getSkillExclusions(tenantId)`, `addSkillExclusion(skill, reason?)`, `removeSkillExclusion(skill)`.
- API: `GET/POST/DELETE /api/skill-exclusions`.
- `getSkillGapStats` filters out excluded skills server-side (cheaper than client filtering) — but **preserves them in a separate `excludedSkills: SkillGapEntry[]` field** on the response so the "Show ignored (N)" toggle can still display them.
- Client: per-row "Ignore" button (small × icon) → optimistic mutation → invalidate `queryKeys.jobs.skillGap`. Add a collapsible "Ignored skills (N)" section at the bottom with restore buttons.
- KPI counts (Strengths / Gaps / Partial) reflect post-exclusion numbers; show a subtle "(N hidden)" suffix if any.

**Acceptance.**
- Clicking "Ignore" on a skill removes it from all visible lists and KPI counts immediately.
- The skill survives page reload and appears in the "Ignored skills" section.
- Restoring brings it back to the appropriate category.
- No effect on the `jobs.skills` column, scoring, or tailoring (verify in tests).

### Feature 3 — Fix user-skill detection

**Problem.** `getSkillGapStats` builds the `userSkillSet` from a single arbitrary `tailoredSkills` row (`.limit(1)` at line ~1154). Whichever job happened to be queried first determines what counts as a "user skill". This explains why CV badges feel inconsistent and why gap classification can drift run-to-run. Tailored skills also include AI-rewritten content, which can hallucinate skills the user doesn't actually have.

**Solution.** Derive `userSkillSet` from a stable, user-controlled source.

**Options (pick one when implementing):**
1. **Profile/CV direct** — the user's stored profile or imported CV (if there's a canonical skills list there). Cleanest source of truth. Check `services/design-resume/import-file.ts` and the design-resume types.
2. **Union across all tailored jobs** — instead of `LIMIT 1`, aggregate keywords from every `tailoredSkills` row for this tenant, with a min-frequency threshold (e.g. skill must appear in ≥3 tailored jobs) to filter out one-off hallucinations.
3. **Hybrid** — profile as primary, union as fallback when profile is empty.

**Implementation notes.**
- Whatever source is chosen, normalise once (lowercase, strip parentheticals, split on `/`) — the existing logic in `getSkillGapStats` is fine; just change the input.
- Add a unit test that verifies: with 5 tailored jobs of varying skill sets, `userSkillSet` is deterministic and not order-dependent.
- Surface the resolved user-skill list somewhere debuggable (existing `data.userSkills` is already returned to the client — could expose it in a "Detected from your profile" section near the controls so the user can sanity-check).

**Acceptance.**
- Two consecutive calls to `getSkillGapStats` produce identical `userSkills` arrays.
- "CV" badges on the page are stable across page reloads.

### Feature 4 — "Why is this here?" explainer

**Problem.** The page has no in-context explanation of how a skill ends up in gap vs partial vs strength. The current line "Match rate = % of jobs with this skill where your score was 75+" is in the card description but doesn't help when staring at one specific row.

**Solution.** Per-skill popover/tooltip on the row that shows:
- Total jobs containing this skill (within the current minScore filter)
- Breakdown: high-score jobs (≥75), mid-score jobs (60–75)
- Whether it matched a user skill, and if so, which CV skill it matched (the fuzzy `includes` match — currently invisible to the user)
- The classification rule that put it in this category, in plain text:
  - Strength: "You have this skill (matched CV skill: 'java'), and it appears in jobs you score 75+ on at least 50% of the time."
  - Gap: "You don't have this skill, and it appears in 2+ jobs scoring 60–75 — learning it could push those into strong matches."
  - Partial: catch-all explanation.

**Implementation notes.**
- Pure UI on `SkillGapPage.tsx`. Use existing tooltip primitive from `@/components/ui/`.
- Server can return the matched user-skill string per entry (a small addition to `SkillGapEntry`) so the tooltip can show "matched 'java'" instead of just a boolean.
- No schema change.

**Acceptance.**
- Hovering or clicking an info icon next to each skill row reveals the explainer.
- The explainer matches the actual classification logic in `getSkillGapStats` (covered by a snapshot test).

### Suggested implementation order

1. **Feature 3 (fix user-skill detection)** first — it's the cheapest cleanup and improves the data quality that the other features rely on.
2. **Feature 1 (click-to-drill)** — high user value, smallest scope, no schema change.
3. **Feature 2 (ignore list)** — schema + API + UI, but isolated.
4. **Feature 4 (explainer)** — polish pass once the data is trustworthy.

---

## Overemployment (OE) toolkit

JobOps doesn't currently model the user holding multiple concurrent jobs. The data we already capture per job (`isRemote`, `workFromHomeType`, `jobType`, `companyNumEmployees`, `companyIndustry`, `jobLevel`, `jobFunction`, `jobDescription`, normalised `monthlyMinPLN/monthlyMaxPLN`, `applicationLink`, `location*`, `salary`) is enough to derive useful OE-specific signals without new extraction pipelines. The missing primitive is the notion of an **active job** — once that exists, several features compose off it.

**Hard non-goals (do not build):**
- Don't claim to provide secrecy or "OE-proof" guarantees. Email, calendar, devices, identity exposure all live outside this app.
- Don't auto-blacklist employers based on signals. Always require user override; signals are advisory.

### OE-1 — OE-fitness score + filter

**Problem.** No way to scan a list of prospects through an OE-suitability lens. User has to read each posting to assess fit.

**Solution.** Compute a 0–100 `oeFitnessScore` per job during processing (or lazily on read). Inputs and weights (tunable):
- `isRemote === true` AND `workFromHomeType === "fully_remote"` (gate — without this, max 30)
- `companyNumEmployees` bucketed: 1–50 → −10, 51–500 → 0, 500–5000 → +10, 5000+ → +15 (bigger = easier to disappear in)
- `jobLevel`: senior/staff/principal +10, mid 0, junior −10
- `jobFunction`: backend/infra/data-platform +10, fullstack 0, frontend/PM/design −5 (proxy for sync-collab intensity; refine over time)
- Red-flag count from OE-2 below: each unique red flag −5 to −20 depending on severity
- Async-friendliness (OE-5) tail-end signal: high async density +5

**Surface.**
- Badge on JobPage and on each card in OrchestratorPage / job lists.
- Filter and sort option in the list views ("OE-fitness ≥ 70").
- New column on the "all jobs" table.

**Implementation notes.**
- Add `oeFitnessScore real` and `oeFitnessReasons text` (JSON: `Array<{ rule, delta, evidence }>`) to `jobs` table. Reasons feed the explainer popover.
- Compute in a new service `services/oe-fitness.ts`. Keep pure (input = job row, output = score + reasons) so it's trivially testable.
- Wire into the pipeline `processJobsStep`. For backfill, a one-off script under `orchestrator/scripts/`.
- Unit-test with table-driven cases per rule.

**Acceptance.**
- Every processed job has a non-null `oeFitnessScore` and reasons.
- Filtering "OE-fitness ≥ 70" hides everything below.
- Tooltip on the badge lists each rule and its contribution.

### OE-2 — Red-flag scanner over job descriptions

**Problem.** Job descriptions hide deal-breakers in dense paragraphs: exclusivity / non-compete, surveillance tooling, core hours, mandatory cameras, employer device, in-person offsites. User reads each posting manually.

**Solution.** A regex/keyword pass over `jobDescription` that emits structured red-flag entries with the matched snippet. Results render as chips on the job card and a section on the JobPage.

**Flag taxonomy (initial set):**
| ID | Severity | Keywords / patterns (illustrative — refine in code) |
|----|----------|------------------------------------------------------|
| `exclusivity` | high | "exclusive employment", "no other employment", "moonlighting", "outside work prohibited" |
| `non_compete` | high | "non-compete", "non compete", "restrictive covenant" |
| `surveillance_tool` | high | "Hubstaff", "Time Doctor", "ActivTrak", "Teramind", "InterGuard", "screen recording", "keystroke", "biometric monitoring" |
| `employer_device_required` | high | "company-issued device", "employer-provided laptop", "no personal devices" |
| `core_hours` | medium | "core hours", "9 to 5", "9-to-6", "must be online \\d{1,2}", "available between \\d{1,2}:\\d{2} and \\d{1,2}:\\d{2}" |
| `on_call_rotation` | medium | "on-call rotation", "pager duty", "PagerDuty rotation", "after-hours support" |
| `mandatory_camera` | medium | "camera on", "camera required", "video on for all meetings" |
| `in_person_offsite` | low | "quarterly offsite", "annual retreat", "in-person summit" |
| `bg_check_deep` | medium | "polygraph", "credit check", "biometric background" |

**Implementation notes.**
- Add `redFlags text` column to `jobs` (JSON: `Array<{ id, severity, snippet }>`). Snippet is ±60 chars around the match.
- Service `services/oe-redflags.ts` exposes `scan(description: string): RedFlag[]`. Keep rules in a single config object so they're easy to extend.
- Run during `processJobsStep` and during backfill.
- Be tolerant of HTML/markdown in `jobDescription` — strip tags before regex.
- False-positive escape hatch: per-tenant suppression list (re-use the schema pattern from skill-exclusions).

**Acceptance.**
- A job with "We use Hubstaff for time tracking" gets a `surveillance_tool` flag with that exact snippet.
- Chips render on JobPage and JobCard; clicking a chip scrolls to/highlights the snippet in the description.
- Suppressed flags don't reappear after pipeline reruns.

### OE-3 — Active-job (J1) registry + salary stack + compatibility

**Problem.** App has no notion that a user might already be employed. Every prospect is evaluated in isolation.

**Solution.** Introduce a first-class concept: an **active employment**. An active employment can either reference an existing `jobs` row (the one the user got hired into) or be a manually-created standalone record (for jobs the user got outside JobOps). Once active employments exist, three derived features become possible.

**Schema.** New table `active_employments`:
- `id text primary key`
- `tenantId text not null`
- `jobId text` (nullable — FK to `jobs.id` if linked)
- `label text not null` (e.g. "J1", "J2", or employer name)
- `employer text not null`
- `startedAt text not null`
- `endedAt text` (nullable; null = current)
- `timezone text` (IANA, e.g. "Europe/Warsaw")
- `coreHoursStart text` (HH:MM in `timezone`)
- `coreHoursEnd text`
- `monthlyGrossPLN real`
- `weeklyHoursBudget integer` (user's estimate of effort, 30/40/50…)
- `industry text` (cached for competitor checks; falls back to linked job's industry)
- `notes text`
- `createdAt`, `updatedAt`

**Derived feature 3a — Salary stack.**
- Headline number on Dashboard / OrchestratorPage: `Sum(monthlyGrossPLN where endedAt is null) × 12` annualised, plus the monthly figure.
- Per-currency aggregation if non-PLN ever lands; for now PLN only.
- Trend line (optional v2): plot total monthly comp over time using `startedAt`/`endedAt`.

**Derived feature 3b — Hours overlap compatibility check.**
- For any prospect job, compare advertised working hours (extracted from description: "must overlap PT 9am–noon", "EU business hours", "9-5 GMT") with each active employment's `coreHoursStart`/`coreHoursEnd` in user's local TZ.
- Render a horizontal day-bar visual: J1 hours / J2 hours / prospect hours. Highlight overlap zones in red, non-overlap in green.
- If overlap exceeds 2h, surface a warning chip on the prospect.

**Derived feature 3c — Competitor flag.**
- For each active employment, maintain a `competitor_employers` sub-list (free-text employer names per active employment).
- A prospect whose `employer` (case-insensitive) matches any active employment's competitor list gets a `competitor` chip with which active employment it conflicts with.
- Auto-suggest competitors based on `companyIndustry` similarity, but require user confirmation before applying.

**API.** `GET/POST/PATCH/DELETE /api/active-employments` plus `POST /api/active-employments/:id/competitors`.

**UI.**
- New settings page or top-level "My Employment" view: list of active employments with edit/end controls.
- Headline stat on dashboard.
- Action on JobPage: "Mark as active employment" (creates or updates an `active_employments` row linked to this `jobId`).
- Compatibility section on JobPage when at least one active employment exists.

**Acceptance.**
- Marking a job as "active" surfaces it in the employment list and contributes to the salary stack.
- A prospect overlapping J1's core hours by 3h shows a red overlap warning.
- A prospect at an employer in J1's competitor list shows a competitor chip.

### OE-4 — Stealth-apply hygiene

**Problem.** Some application paths leak identity to a user's network. LinkedIn Easy Apply, in particular, is visible to connections — including current employer recruiters.

**Solution.** Per-job classification of the application path with risk level + safer alternative when one exists.

**Rules.**
- `applicationLink` matches `linkedin.com/.../apply` or source is LinkedIn → flag `network_visible`.
- `applicationLink` matches known ATS domains (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, …) → flag `direct_ats` (low risk).
- Same job exists with multiple links (rare, but happens via dedup): prefer the direct ATS one and surface "Apply via ATS instead of LinkedIn".
- Email-only applications (`emails` populated, no link) → flag `email_only`, low risk but archive recipient address.

**Schema.** Add `applyRiskLevel text` (`low` | `medium` | `high`) and `applyRiskReason text` to `jobs`. Or compute on the fly in the API response — no schema change needed if we don't want to persist.

**UI.** Small icon next to the apply button on JobPage. Tooltip explains the risk and recommended alternative.

**Acceptance.**
- LinkedIn-only apply path renders a yellow shield icon with "Visible to your network" tooltip.
- Direct ATS apply renders a green shield with "Direct apply (lower visibility)".
- Suggested alternative link is surfaced when the same job has both paths.

### OE-5 — Async-friendliness signal

**Problem.** "Remote" doesn't equal "async". A remote role with 5 daily standups across timezones is hostile to OE; one with written-doc culture is ideal. OE-fitness rolls this in, but it's worth as a standalone surfaced signal because it tracks something different from "is this OE-tolerable".

**Solution.** Compute an `asyncScore` 0–100 from keyword densities in `jobDescription`:
- **Sync-heavy keywords (negative):** "daily standup", "stand-up", "sync meeting", "pair programming", "always on", "real-time", "synchronous", "live whiteboarding", "video call required"
- **Async-friendly keywords (positive):** "async", "asynchronous", "written communication", "RFC", "design doc", "Loom", "documentation-first", "no meetings", "deep work", "async-first"

**Implementation notes.**
- Service `services/oe-async-score.ts`. Density = matches per 1000 words; final score = `clamp(50 + (asyncDensity − syncDensity) × k, 0, 100)`.
- Persist `asyncScore real` and `asyncSignals text` (JSON of matched terms) on `jobs`.
- Compute in `processJobsStep`.

**Surface.** Standalone tag on JobPage and JobCard. Filterable.

**Acceptance.**
- Job mentioning "Daily standup at 9am" 3× scores < 40.
- Job mentioning "Async-first, written-doc culture, no recurring meetings" scores > 80.

### OE-6 — OE-friendly employer index

**Problem.** Some employers consistently post OE-tolerable roles. User can't see this aggregated.

**Solution.** Per-employer rollup view (new page or section on EmployerInsightsPage):
- Avg `oeFitnessScore` across this employer's postings
- Median `asyncScore`
- Count of red-flag occurrences by type
- Number of postings seen, time range
- Sorted by avg OE-fitness desc, with a min-postings filter (≥3) to reduce noise

**Implementation notes.**
- Pure aggregation query; no new tables. Data comes from OE-1, OE-2, OE-5.
- Cache the aggregation with a short TTL since it scans all jobs for the tenant.
- Already have an `EmployerInsightsPage.tsx` per the working tree — extend it.

**Acceptance.**
- Page shows top 50 employers by avg OE-fitness with min 3 postings.
- Clicking an employer drills into their job list filtered by OE-fitness.

### OE-7 — Workload / hours-budget estimator

**Problem.** Stacking jobs is only viable if total committed hours fit a finite week. Currently no view of this.

**Solution.** Per-job estimated `weeklyHoursEstimate` (integer 20–60), and a stacker view summing across active employments.

**Per-job estimation rules (heuristic — refine over time).**
- Base 40h.
- `jobLevel` senior/staff: ±0; junior: +5 (more hand-holding); principal/architect: −5 (more autonomy)
- On-call rotation red flag: +5
- Core-hours red flag: +5 (less flexibility means less compression possible)
- High sync-keyword density (OE-5 < 40): +5
- High async density (OE-5 > 80): −5
- `companyNumEmployees` < 50 (startup): +10 (chaotic hours expected)
- Clamp to [20, 60]

**Surface.**
- Tag on JobCard ("~45h/wk").
- On the active-employments list (OE-3), each row shows the estimate; total is summed against a user-set ceiling (default 65h/wk in settings).
- When marking a new job as active, if the new total would exceed the ceiling, show a confirmation dialog with the breakdown.

**Implementation notes.**
- Service `services/oe-workload.ts` with the same shape as OE-1 (pure, table-tested).
- Persist `weeklyHoursEstimate integer` and `weeklyHoursReasons text` (JSON) on `jobs`.
- Add `weeklyHoursCeiling integer` to user settings (default 65).
- Override hook on the active employment row: user can manually set `weeklyHoursBudget` from OE-3 to overrule the estimate; the stacker uses budget if set, otherwise estimate.

**Acceptance.**
- Each processed job has a non-null `weeklyHoursEstimate`.
- Active-employments view shows running total against the ceiling, with a warning when over.
- Manual budget override on an active employment is respected by the total.

### Suggested implementation order

1. **OE-1 + OE-2** together — the scoring rules and red-flag scanner share the most plumbing (same processing-step hook, same explainer pattern, schema migration is one PR). Backfill script ships with this slice.
2. **OE-5 (async signal)** — feeds OE-1's score; light to add once OE-1 exists.
3. **OE-3 (active employments)** — the foundation for stacking. Schema, CRUD, salary stack first; compatibility/competitor follow as separate PRs.
4. **OE-7 (workload estimator)** — depends on the active-employments table existing.
5. **OE-4 (stealth hygiene)** — small, independent, can ship anywhere in the order.
6. **OE-6 (employer index)** — last; pure aggregation over OE-1/2/5 outputs, so do it once those have data.

---

## Polish job board extractors — missing job descriptions

**Affected extractors:** `pracujpl`, `justjoinit`, `bulldogjob`, `theprotocol`.

### Root cause

All four scrape only the **search-listing** endpoint of their respective board. Listing payloads return summary data (title, employer, location, salary, skills/tags) but **never include description text**. Each mapper (`mapOffer`/`mapNode`/`mapGroup`) does not even attempt to set `jobDescription` — the field is unconditionally absent on the produced `CreateJobInput`.

| Extractor | File | Listing source | Missing field |
|-----------|------|----------------|----------------|
| pracujpl | `extractors/pracujpl/src/main.ts:102` | `__NEXT_DATA__` → `pageProps.dehydratedState.queries[jobOffers].state.data.groupedOffers[]` | description |
| justjoinit | `extractors/justjoinit/src/run.ts:101` | `https://api.justjoin.it/v2/user-panel/offers` (list) | `body` / `markdownBody` |
| bulldogjob | `extractors/bulldogjob/src/run.ts:5` | GraphQL `searchJobs` query | description (not selected in query) |
| theprotocol | `extractors/theprotocol/src/main.ts:131` | `__NEXT_DATA__` → `pageProps.offersResponse.offers[]` | description |

### Why it matters

`jobDescription` is the primary input for LLM scoring (`scoreJobsStep`) and tailoring (`processJobsStep`). When it's null, those steps fall back to title + skills, which gives heavily degraded scores and tailoring quality. It also breaks the OE-2 red-flag scanner and OE-5 async-friendliness signal proposed earlier in this file, both of which require description text.

### Decided shape of the fix

- **Storage format:** plain text, HTML stripped, paragraph breaks preserved. Match what other working extractors already do.
- **Failure mode:** degrade gracefully. If a description can't be fetched, persist the job with `jobDescription = null` and a structured warning in the run log. The pipeline continues with title+skills scoring (current behaviour for null descriptions).
- **For pracujpl + theprotocol:** **probe for a JSON API first.** If a usable detail-API exists, use it. If not, **skip description fetching for that source** — don't fall back to per-offer browser navigation. Browser-based detail fetching is too costly (~2–5s per job × 50 jobs/term × multiple terms) and risks IP/CF rate-limiting.
- **For justjoinit + bulldogjob:** the fix is API-only and cheap; ship it.

### Per-source plan

#### PD-1 — bulldogjob (cheapest)

GraphQL field is omitted, not unavailable. Two-step fix:

1. **Probe** the schema. Run an introspection query or a probe query against the `Job`/`Offer` type to confirm the description field name. Likely candidates: `description`, `body`, `descriptionHtml`. Run once manually; commit the discovery as a comment.
2. **Add the field** to `JOBS_QUERY` at line 5 of `run.ts`. Strip HTML in `mapNode`. No extra requests, no concurrency considerations.

**Acceptance.** A bulldogjob extraction run produces jobs with non-empty `jobDescription` for every result. No additional latency vs current run.

#### PD-2 — justjoinit (API per offer)

The list endpoint is `https://api.justjoin.it/v2/user-panel/offers`. The detail endpoint mirrors it: `https://api.justjoin.it/v2/user-panel/offers/{slug}` and returns `body` (HTML) and `markdownBody` (Markdown). Fix:

1. After listing offers, run a bounded-concurrency pass that fetches each detail by slug. Concurrency cap: **5** (conservative starting value; tune if rate-limited).
2. Prefer `markdownBody` if present, else `body`; convert to plain text (strip Markdown / strip HTML) before storing.
3. Dedup detail fetches by `slug` across search terms — same job often appears for multiple terms.
4. On any single-detail failure (non-2xx, network, parse): log a structured warning, keep the job with `jobDescription = null`, continue.

**Acceptance.**
- Fresh extraction populates `jobDescription` for ≥95% of jobs (allowing for occasional API failures).
- Total run time increase ≤ 3× current.
- One transient failure does not abort the run.

#### PD-3 — pracujpl (probe-first, may end with a "skip" decision)

The current SSR listing scrape is fragile and CF-protected. Detail-page browser navigation is explicitly off the table. Plan:

1. **API probe phase (one-off investigation).** Goals:
   - Inspect network traffic on `it.pracuj.pl` and `www.pracuj.pl/praca/...` (a single offer page) to see what JSON the SPA fetches.
   - Specifically check for endpoints under `/api/`, `/it/api/`, or `apigw.pracuj.pl` that return offer detail keyed by the numeric `oferta` id (already extracted in `mapGroup` at line 110).
   - Test one such endpoint without browser cookies — does it work with vanilla fetch + UA header, or does it require CF clearance + bearer token?
2. **Decision branch:**
   - **API found, fetchable without browser:** add a detail-fetch pass with concurrency 3 (lower than justjoin given CF risk), HTML→plain-text conversion, dedup by `sourceJobId`, graceful degrade.
   - **API found, requires browser cookies:** still cheaper than per-offer page navigation; reuse the existing camoufox context to add cookie+UA headers to vanilla fetch calls. Same concurrency 3.
   - **No usable API:** stop. Document the finding in the extractor's source as a comment ("no detail API; descriptions intentionally omitted; see IDEAS.md PD-3"). Do **not** add per-offer browser navigation.
3. **Add a probe artefact** (one-off script under `extractors/pracujpl/probes/` or similar) so this investigation is reproducible if pracuj.pl changes their stack.

**Acceptance (if API found).** Same shape as PD-2 — ≥95% description coverage, run time ≤ 3× current, transient failures don't abort. **Acceptance (if no API):** code comment + IDEAS.md update documenting the dead end; no other changes.

#### PD-4 — theprotocol (probe-first)

Same investigative approach as PD-3.

1. **Probe.** Inspect network calls on `theprotocol.it/praca/{offerUrlName}` for JSON detail endpoints. Likely candidates given their Next.js stack: `/api/offers/{id}`, `/api/offer/{slug}`, or a public search-API host. Each offer has both a numeric `id` and an `offerUrlName` (mapper at line 131) — either may key the detail call.
2. **Decision branch** identical to PD-3 (API → use it; no API → skip and document).
3. **Probe artefact** under `extractors/theprotocol/probes/`.

**Acceptance.** Same as PD-3 per branch.

### Cross-cutting work (do once, share across PD-1..4)

- **HTML→plain-text helper.** Centralise in `shared/src/utils/` (e.g. `htmlToPlainText.ts`) — strip tags, decode entities, collapse whitespace, preserve paragraph breaks via `\n\n`. Export tests with golden inputs covering: nested lists, `<br>`, entity encoding, malformed HTML.
- **Markdown→plain-text helper.** Strip `# `, `**`, `_`, list bullets, link syntax `[text](url) → text`. Used by justjoinit when `markdownBody` is preferred.
- **Bounded concurrency helper.** If one doesn't already exist in `shared/`, add a tiny `mapWithConcurrency<T, R>(items, limit, fn)` utility. (Check `shared/src/` first — there's a fair chance one is already in use.)
- **Run-log warning shape.** Use the existing extractor progress/event pipeline (`emitProgress` etc.) to surface a `description_fetch_failed` event with `{ sourceJobId, reason }` so failures are visible in the orchestrator UI run details panel without grep-ing logs.

### Backfill

Existing rows in `jobs` for these four sources have `jobDescription = null`. After the fixes ship:

- One-off script under `orchestrator/scripts/backfill-pl-descriptions.ts` that re-fetches descriptions for `source IN ('pracujpl', 'justjoinit', 'bulldogjob', 'theprotocol') AND jobDescription IS NULL AND status NOT IN ('expired', 'skipped')`.
- Runs the same per-source detail-fetch logic. Skip rows older than N days (default 30) since those postings may be gone anyway.
- Exits cleanly so it can be a cron candidate (out of scope for this task; just leave it runnable manually).

### Suggested implementation order

1. **PD-1 (bulldogjob)** — smallest scope, highest signal-to-effort ratio, validates the cross-cutting helpers.
2. **PD-2 (justjoinit)** — second simplest, exercises the concurrency + degrade path with a real API.
3. **PD-3 + PD-4 probes** — investigation only. Outcome determines whether they're a code change or a documented dead-end.
4. **Backfill script** once all sources are settled.

---

## Career intelligence toolkit (pivot, niche, semantic)

JobOps is run as two separate Docker instances — one for the primary user, one for the spouse. Multi-profile within a single instance is therefore explicitly **not** a goal; every feature here is single-tenant and ships identically to both deployments.

The features in this section serve two distinct user goals captured during planning:
- **Primary user:** identify skill gaps + find chill OE-friendly jobs (already covered by Skill Gap section + OE toolkit).
- **Spouse:** find jobs in a niche skill set, AND get guidance on how to rebrand based on adjacent skill clusters in the market.

The shared underlying need is to understand the *market* in skill-space, not just per-job. The features below are ordered by dependency: **CI-3 (embeddings)** is foundational for the strongest versions of CI-1 and CI-4, but each can ship in a keyword-only MVP first.

### CI-1 — Career pivot finder (rebrand)

**Problem.** SkillGapPage answers "what should I learn for jobs I want?" — gap-fill thinking. The inverse question matters more for someone in a niche: "given my skills, which job clusters are *closest* to me, and what's the smallest learning delta to land each?" Today the app cannot answer this.

**Solution.** A new page `Career Pivot Finder` that:
1. Pulls user skills from CV / profile (use the fixed source from Skill-Gap Feature 3 — not the `LIMIT 1` `tailoredSkills` hack).
2. Clusters available jobs in skill-space (job → bag of skills + title + tailored skills if available).
3. For each cluster, surfaces:
   - **Representative title** (most frequent job title in cluster, normalised).
   - **Overlap %** with user's skill set (Jaccard MVP; cosine over embeddings once CI-3 lands).
   - **Bridge skills** — skills present in ≥30% of cluster jobs but absent from user CV, ranked by frequency × overlap-lift.
   - **Salary band** — median + p25/p75 from the cluster (reuse existing `salaryStats` machinery in `getStatsTotalsAndDistributions`).
   - **Job count + freshness** (postings in last 30 days).
   - **Suggested CV headline rewrite** — one-liner from a small LLM prompt: "Given user's current title + cluster's representative title + top shared skills, propose a rebrand headline."
4. Ranks clusters by overlap descending; shows top 5–10 with overlap ≥ 40%.

**Implementation notes.**
- Service `services/career-pivot.ts`. Pure function: `findPivotClusters({ userSkills, jobs }) → ClusterResult[]`.
- **MVP (no embeddings):** k-means or greedy clustering over skill multi-hot vectors. k=8, distance = 1 − Jaccard.
- **v2 (with CI-3 embeddings):** cluster over job-description embeddings, much better cluster quality.
- Title normalisation utility (strip seniority prefixes, lowercase, split on slash) — shared with CI-4.
- Cache result per tenant with 1-day TTL; recompute on demand or after major pipeline runs.
- Headline-rewrite call goes through existing `services/llm/service.ts`.

**Surface.** New top-level nav entry "Pivot Finder" — but only visible when user has ≥1 cluster with overlap ≥ 40% (otherwise the page would feel broken on cold-start tenants).

**Acceptance.**
- Page renders ≥3 clusters with overlap %, bridge skills, salary range.
- Bridge skills are *not* user skills (test the diff).
- Re-running on the same data yields stable cluster IDs (deterministic init).

### CI-2 — Niche-skill alerts + market monitor

**Problem.** For rare skills (e.g. spouse's niche), the regular pipeline is too noisy — relevant matches are 1-in-200. User needs targeted monitoring + early warning when the niche shrinks.

**Solution.**

**A. Watchlist alerts.**
- User defines a watchlist: list of `(skill, optional title-pattern)` entries with per-entry alert preferences.
- After each pipeline run, a service compares newly-imported jobs against each watch entry; matches enqueue an in-app notification (and optionally email if a webhook is configured).
- On JobPage, a "Niche match" badge appears for jobs that hit any watchlist entry, with the matched entry name.

**B. Per-skill market monitor.**
- Weekly snapshot per watched skill: job count, avg suitability score, median salary (where available), top 3 employers.
- Trend chart on a new "Watchlist" page (8 / 12 / 26 weeks selectable).
- Threshold-based alerts: drop > N% over rolling 4-week vs prior 4-week → "niche shrinking, consider learning bridge skill" notification. Symmetric upward alert.

**Implementation notes.**
- Schema:
  - `skill_watchlist (id, tenantId, skill, label, titlePattern, alertOnDrop, alertOnRise, dropThresholdPct, riseThresholdPct, notes, createdAt)`.
  - Reuse the existing `skillSnapshots` table (`repositories/skill-snapshots.ts`) — extend the snapshot-capture script to additionally record per-watchlist-skill metrics if not already covered. Watchlist-driven snapshots use the same row format with a `source = 'watchlist'` discriminator if needed.
- Service `services/niche-monitor.ts`. Pure trend + threshold logic.
- Notifications: integrate with whatever notification infra exists (the working tree shows post-application messaging — likely reusable). If nothing exists, MVP is a badge count in the top nav linking to the watchlist page.
- Email delivery is **optional and out of scope for MVP** — surface as in-app only first.

**Surface.** New "Watchlist" page (sibling of SkillGapPage). Per-skill rows: name, current count, 4-week delta, sparkline, manage-alerts button. Add-skill input at top.

**Acceptance.**
- Adding "Apache Beam" to watchlist; next pipeline run that imports a Beam job triggers an in-app notification.
- After ≥4 weekly snapshots, a 30%+ drop fires a downward alert.
- Removing a watch entry stops alerts but preserves historical snapshots.

### CI-3 — Embedding-based semantic similarity (foundational)

**Problem.** Current scoring is LLM-per-job (expensive) and skill matching is exact keyword. Both miss semantic equivalence ("Snowflake admin" ≈ "Data warehouse engineer", "ETL pipelines" ≈ "data integration"). Niche recall and pivot quality both suffer.

**Solution.** Add an embeddings layer that produces a fixed-dim vector per job description and per user profile, enabling cosine similarity for fast semantic search.

**Implementation notes.**
- Service `services/llm/embeddings.ts`. Provider-agnostic (mirror existing `services/llm/service.ts` shape). Defaults:
  - OpenAI: `text-embedding-3-small` (1536-dim, cheap).
  - Gemini: `text-embedding-004` (768-dim).
  - OpenRouter: route through to OpenAI by default.
- Schema: new table `job_embeddings (jobId, embedding BLOB, model TEXT, dim INTEGER, generatedAt TEXT)`. Storing in a side table (vs adding a column to `jobs`) lets us re-embed cleanly when models change without dirtying every row's `updatedAt`.
- User-profile embedding stored in `settings` or new `tenant_profile_embeddings (tenantId, embedding, model, generatedAt)`. Regenerate when CV/profile changes (hash-based dirty check).
- Pipeline: new step `embedJobsStep` between import and score. Idempotent — skip jobs with current-model embedding already stored.
- Vector search: in-process float32 cosine for SQLite scale (≤50k jobs is fine; sub-50ms/pair). If scale becomes an issue, add `sqlite-vec` later — out of scope for MVP.
- Embed input shape: `${title}\n${employer}\n${skills}\n${jobDescription.slice(0, 4000)}`. Capped to keep token cost predictable.
- Backfill script `orchestrator/scripts/backfill-job-embeddings.ts` for existing rows.

**Direct user-facing payoffs.**
- "Similar jobs" panel on JobPage (top 5 by cosine).
- Better CI-1 pivot clusters (semantic similarity beats Jaccard).
- Better CI-4 reverse search.
- Optional: log "LLM-suitability vs embedding-similarity" disagreement as a soft signal for QA — not a user feature, but useful for debugging scoring drift.

**Acceptance.**
- Every imported job has an embedding within 60 seconds of `embedJobsStep` running.
- "Similar jobs" panel on JobPage returns 5 results in <200ms.
- Re-embedding all jobs from CLI is idempotent and resumable.

### CI-4 — Reverse search (skills → titles by demand)

**Problem.** SkillGapPage is skill-centric. The reverse view — "where in the market are my skills wanted?" — is missing and is exactly what someone considering a rebrand needs.

**Solution.** A page where input = skills (default = user's CV skills, editable), output = ranked job titles in the database with:
- Title (normalised — strip seniority levels, lowercase, dedup near-duplicates).
- Number of jobs.
- Avg overlap % between input skills and that title's typical skill set.
- Avg suitability score (where scored).
- Median salary (where present).
- Top 3 employers in that title.

Ranked by `overlap × log(count + 1)` — combines relevance and demand without count dominating.

**Implementation notes.**
- Service `services/skill-demand-search.ts`. Pure, stateless, deterministic.
- Endpoint `GET /api/jobs/skill-demand?skills=java,kafka,...`.
- Title normalisation utility — share with CI-1.
- New page `/skill-demand` (or as a tab on SkillGapPage).
- Debounce 300ms on skill input changes.

**Acceptance.**
- Default load with current CV skills pre-filled returns ≥10 titles.
- Editing the skill list re-ranks results within a second.
- Each row links to the JobPage list filtered by `title=...`.

### CI-5 — Skill co-occurrence map

**Problem.** Want to know which skills travel together — the cheapest bridge skills extending the user's current set.

**Solution.** For each user skill, surface top 10 co-occurring skills with:
- **Co-occurrence rate** (% of jobs containing the user's skill that also contain skill X).
- **User-already-has** flag (filter toggle: "show only bridges I don't have yet").
- **Average overlap** across the co-occurring jobs (lets the user see "skills that travel with mine in *high-quality* matches" vs noise).

Optional v2: force-directed graph view for visual learners. MVP is a simple per-skill table.

**Implementation notes.**
- Service `services/skill-cooccurrence.ts`. Two implementations:
  - **Lazy** (MVP): on demand for a single skill, query jobs containing it, split skills, count co-occurrences. Acceptable up to ~10k jobs.
  - **Pre-computed**: new table `skill_cooccurrence (tenantId, skillA, skillB, jointCount, lastComputedAt)` with `(tenantId, skillA, skillB)` PK. Refreshed by a cron job. Necessary if the lazy version exceeds ~500ms.
- Surface as a section on SkillGapPage or alongside CI-1.

**Acceptance.**
- For any user skill, returns top 10 co-occurring skills with rates.
- The "bridges only" toggle removes user-owned skills.
- Sub-second response on tenants with <10k jobs.

### CI-6 — Personal market monitor

**Problem.** Hard to tell whether the market is moving toward or away from the user's profile over time. Lacking this signal, "should I learn or rebrand?" is a gut call.

**Solution.** Weekly per-tenant snapshot capturing:
- Total jobs imported.
- Jobs scoring ≥60 and ≥75 (matching-profile counts).
- Avg suitability score.
- Top 10 skills by demand (already exists in `topSkills`).

Surfaced as:
- **Trend chart** on Dashboard / OrchestratorPage: matching-jobs over last 8 / 12 / 26 weeks.
- **Comparison line** for "all jobs imported" — distinguishes "market shrinking overall" from "market shifting away from my skills".
- **Threshold alert** when matching-jobs drops > 30% over rolling 4-week vs prior 4-week → in-app notification "consider learning or rebranding".

**Implementation notes.**
- Schema: `profile_market_snapshots (tenantId, week, totalJobs, jobsAbove60, jobsAbove75, avgScore, topSkillsJson, capturedAt)` with `(tenantId, week)` PK.
- Capture: extend the existing `snapshot-skills.ts` script to also write a profile-market row, or a sibling script `snapshot-profile-market.ts` invoked by the same cron.
- Reuse Recharts (presumably already in the client given the existing trend rendering on SkillGapPage).
- Alert reuses CI-2's notification surface.

**Acceptance.**
- Trend chart visible after ≥2 weekly snapshots.
- Alert fires when 30%+ drop is detected vs the prior 4-week window.
- Comparison line ("all jobs") toggleable.

### Suggested implementation order

1. **CI-3 (embeddings)** first — foundational. Even shipped as a bare "similar jobs" panel on JobPage, it pays for itself, and unlocks meaningful versions of CI-1 + CI-4.
2. **CI-4 (reverse search)** — small scope, single page, immediately useful for rebrand exploration.
3. **CI-1 (pivot finder)** — the headline feature for the spouse. Ship MVP on Jaccard if CI-3 isn't ready; upgrade to embeddings later.
4. **CI-2 (watchlist + market monitor)** — schema + alert surface. Independent of the above.
5. **CI-5 (co-occurrence map)** — light, complementary. Easy to fit alongside CI-1.
6. **CI-6 (personal market monitor)** — last; depends on weekly snapshots accumulating, so the value is delayed regardless of when it ships.
