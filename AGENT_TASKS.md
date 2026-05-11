# Overnight agent task list

This file briefs an autonomous coding agent on a sequence of self-contained tasks drawn from `IDEAS.md`. The agent should work top-to-bottom and stop when it runs out of tasks, time, or hits a blocker.

## Ground rules

- **Do not push or open PRs.** All work stays local. Commit per task.
- **Branch.** Create one branch at the start: `git switch -c agent/overnight-$(date +%Y%m%d)`. All commits land here.
- **Skip on blocker.** If a task can't be finished cleanly (failing tests it can't fix, ambiguous requirement, missing external dep, anything that would normally prompt a question), do this in order:
  1. `git restore --staged --worktree .` to revert the partial work for that task only.
  2. Append a section to `REPORT.md` explaining what was attempted, the specific blocker, and any code references the human will need.
  3. Continue with the next task. Do not retry the same blocker more than once.
- **Commit style.** One commit per task on completion, message format:
  ```
  <area>: <one-line summary>

  <2-3 line body explaining the why>

  Refs IDEAS.md task <Tx>.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
- **Verify before commit.** For every task, run the CI-parity subset relevant to the touched files:
  ```bash
  ./orchestrator/node_modules/.bin/biome ci .
  npm run check:types:shared
  npm --workspace orchestrator run check:types
  npm --workspace orchestrator run test:run -- <touched-test-files>
  npm --workspace orchestrator run build:client    # only if client files changed
  ```
  Skip the workspace type checks for extractor packages unless that workspace was touched.
- **Test conventions.** Tests live alongside source as `*.test.ts` / `*.test.tsx`. Vitest. Integration tests hit the real SQLite DB — do not mock it.
- **Coding conventions.** Use `logger` from `@infra/logger` (no `console.*`). Use `AppError` from `@infra/errors`. Follow the API contract `{ ok: true, data, meta: { requestId } }` / `{ ok: false, error: { code, message }, meta }`. Path aliases `@server/*`, `@infra/*`, `@client/*` (or `@/*`), `@shared/*` — no relative cross-boundary imports.
- **Do not write planning docs, summaries, or README updates.** The only doc you may write is `REPORT.md` (blocker + completion log). Do not add backwards-compatibility shims or unused-but-exported code.
- **Final step.** When the run ends (last task completed or aborted), write `REPORT.md` with the completion summary described at the bottom of this file.

---

## Task order

Tasks are ordered so that earlier ones either improve data quality for later ones or share infrastructure. Each is scoped to be completable in one focused session. Stretch tasks (T7, T8) are larger; only attempt them if T1–T6 are clean.

### T1 — Fix user-skill detection in skill-gap analysis

**Source:** IDEAS.md → "Feature 3 — Fix user-skill detection".

**Files.**
- `orchestrator/src/server/repositories/jobs.ts` (function `getSkillGapStats`, line ~1143; specifically the `LIMIT 1` block at lines ~1149–1169).
- New test colocated with the repo file or in an existing test file for jobs repo.

**Plan.**
1. Replace the `.limit(1)` query against `jobs.tailoredSkills` with a union across **all** rows for the tenant.
2. Build `userSkillSet` by parsing every `tailoredSkills` JSON, lowercasing keywords, applying the same parenthetical/slash normalisation already in the function.
3. Apply a min-frequency threshold of `≥ 3` (a skill must appear in at least 3 distinct tailored jobs to count) — filters AI-hallucinated skills.
4. Keep behaviour identical when there are <3 tailored jobs total: in that case, fall back to "use all keywords from whatever rows exist" (preserves cold-start usability).
5. Add a unit test:
   - Seed 5 tailored-skill rows with overlapping and disjoint skills.
   - Assert `userSkills` array is identical across two consecutive calls (deterministic).
   - Assert that a skill appearing in only 1 tailored row is excluded when ≥3 rows exist.

**Acceptance.**
- Two consecutive calls to `getSkillGapStats` return identical `userSkills`.
- "CV" badges on `SkillGapPage` are stable across reloads (verify by hitting the endpoint twice and diffing).

**Verification.** `npm --workspace orchestrator run test:run -- repositories` plus `check:types`.

---

### T2 — bulldogjob job descriptions

**Source:** IDEAS.md → "PD-1 — bulldogjob".

**Files.**
- `extractors/bulldogjob/src/run.ts` (GraphQL query at line 5; mapper at line 104).
- `shared/src/utils/htmlToPlainText.ts` (NEW — cross-cutting helper).
- `shared/src/utils/htmlToPlainText.test.ts` (NEW).
- `extractors/bulldogjob/tests/run.test.ts` (likely exists; extend).

**Plan.**
1. **Probe step.** Run a one-off introspection query against `https://bulldogjob.pl/graphql` to discover the description field name on the job/offer type. Likely candidates: `description`, `body`, `descriptionHtml`. Suggested introspection request body:
   ```json
   {"query": "{ __type(name: \"Job\") { fields { name type { name kind ofType { name } } } } }"}
   ```
   Send POST with `content-type: application/json`. If `Job` is not the type name, also try `Offer`. Record the discovered field name as a code comment in `run.ts` next to the query.
2. **Helper.** Add `htmlToPlainText(html: string): string` in `shared/src/utils/htmlToPlainText.ts`:
   - Strip tags (regex `/<[^>]+>/g` is fine for this scope).
   - Decode common HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`).
   - Convert `<br>` and block-level closers (`</p>`, `</li>`, `</div>`) to `\n`.
   - Collapse runs of whitespace, preserve double-newlines for paragraph breaks.
3. **Wire up.** Add the discovered description field to `JOBS_QUERY`. In `mapNode`, set `jobDescription: htmlToPlainText(node.description)` (using whatever field name was discovered).
4. **Tests.** Add tests for `htmlToPlainText` covering: nested lists, `<br>` handling, entity decoding, malformed HTML (no crash). Update bulldogjob run test if it asserts on the shape of `CreateJobInput`.

**Blocker rule.** If the introspection probe fails (network, schema hidden), skip this task. Do **not** guess the field name.

**Acceptance.**
- New helper has ≥4 passing tests covering the cases above.
- Bulldogjob test fixtures include a `jobDescription` field.

**Verification.** `npm run check:types:shared` plus the bulldogjob workspace tests.

---

### T3 — Click-to-drill on skill rows

**Source:** IDEAS.md → "Feature 1 — Click-to-drill: skill → contributing jobs".

**Files.**
- `orchestrator/src/server/repositories/jobs.ts` — add `getJobsBySkill({ skill, minScore }): Promise<JobBySkillSummary[]>`.
- `orchestrator/src/server/api/routes/jobs/read.ts` — new endpoint `GET /api/jobs/by-skill`.
- `orchestrator/src/client/api/jobs.ts` — client function `getJobsBySkill(skill, minScore)`.
- `orchestrator/src/client/lib/queryKeys.ts` — add `jobs.bySkill(skill, minScore)`.
- `orchestrator/src/client/pages/SkillGapPage.tsx` — make skill rows + callout chips clickable; render a sheet/modal listing contributing jobs.
- New component file under `orchestrator/src/client/pages/` or `components/`.

**Plan.**
1. **Repository.** Query: `tenantId === active`, `suitabilityScore >= minScore`, `skills LIKE '%<skill>%'` with case-insensitive comparison. Reuse the same `SKIP_TERMS` filter logic (out of scope here — but the search input must be the unmodified skill string from the row). Return: `{ id, title, employer, score, source, discoveredAt }`. Order by `score DESC`. Cap at 200 rows defensively.
2. **Endpoint.** Validate query params with the same patterns used elsewhere in `read.ts`. Return shape `{ ok: true, data: { jobs: [...] }, meta: { requestId } }`.
3. **Client.** Wrap in TanStack Query, key from `queryKeys.jobs.bySkill`. Open on row click; close on background click or escape.
4. **Test.**
   - Repository test: seed a job with skills="Java, Kafka", another with "Java, Spring"; query `getJobsBySkill({ skill: "Java", minScore: 0 })` returns both, ordered by score.
   - API test using existing `test-utils.ts`: hits the endpoint, asserts response shape.
   - Component test: clicking a row opens the panel; clicking close button closes it.

**Acceptance.**
- Click any skill in detail table or callouts → panel opens with N rows where N matches the row's count.
- Each row links to `/jobs/:id`.

**Verification.** Repository, API, and component test files; `check:types`; `build:client` (UI changes).

---

### T4 — "Why is this here?" explainer popover

**Source:** IDEAS.md → "Feature 4 — 'Why is this here?' explainer".

**Files.**
- `orchestrator/src/server/repositories/jobs.ts` — extend `SkillGapEntry` with `matchedUserSkill?: string` (the user-skill that fuzzy-matched, when applicable).
- `orchestrator/src/client/api/jobs.ts` — propagate the new field in the type.
- `orchestrator/src/client/pages/SkillGapPage.tsx` — add a popover / tooltip per skill row with the rule explanation.

**Plan.**
1. In `getSkillGapStats`, when a skill is classified `strength` because of fuzzy match, capture which user-skill matched. Set `matchedUserSkill` on the entry.
2. Use existing tooltip primitive from `@/components/ui/`. Show:
   - Total + breakdown (high ≥75, mid 60–75).
   - User-skill match (if any).
   - Rule applied, in plain text per the three categories listed in IDEAS.md.
3. Test: snapshot the explainer for one entry of each category.

**Acceptance.**
- Hover/click on each skill row reveals the explainer.
- Strength categories show the matched user-skill name.

**Verification.** Component snapshot test; `check:types`; `build:client`.

---

### T5 — OE red-flag scanner

**Source:** IDEAS.md → "OE-2 — Red-flag scanner over job descriptions".

**Files.**
- `orchestrator/src/server/services/oe-redflags.ts` (NEW) — pure scanner.
- `orchestrator/src/server/services/oe-redflags.test.ts` (NEW) — table-driven tests.
- `orchestrator/src/server/db/schema.ts` — add `redFlags: text("red_flags")` (JSON-encoded string) to the `jobs` table.
- New Drizzle migration in `orchestrator/src/server/db/`.
- `orchestrator/src/server/pipeline/orchestrator.ts` (or `processJobsStep` file) — wire scanner into job processing.
- `orchestrator/src/client/api/jobs.ts` — propagate `redFlags` field on the job type.
- `orchestrator/src/client/pages/JobPage.tsx` — render red-flag chips.
- `orchestrator/scripts/backfill-oe-redflags.ts` (NEW) — backfill script.

**Plan.**
1. **Service.** `scan(description: string | null): RedFlag[]` returning `Array<{ id: string; severity: 'high'|'medium'|'low'; snippet: string }>`. Use the rule taxonomy table from IDEAS.md OE-2. Strip HTML before regex (reuse `htmlToPlainText` from T2 if shipped; otherwise implement minimal stripping inline). Snippet = ±60 chars around the first match per rule.
2. **Schema migration.** Add `red_flags TEXT` column. Default null. No backfill in the migration itself.
3. **Pipeline wire-up.** In the processing step that already handles per-job enrichment, call `scan(jobDescription)` and persist as JSON string. Skip if `redFlags` is already set (idempotent).
4. **UI.** On JobPage, render chips below the title with severity-coloured borders (high=red, medium=yellow, low=neutral). Click reveals the matched snippet.
5. **Backfill script.** Iterate jobs where `redFlags IS NULL AND jobDescription IS NOT NULL`, batch in groups of 100, persist results. Idempotent.
6. **Tests.** For each rule in the taxonomy, a positive case (text containing the trigger → flag emitted with correct severity) and a negative case (similar but non-triggering text → no flag). At least 18 cases.

**Acceptance.**
- A job with "We use Hubstaff for time tracking" produces a `surveillance_tool` flag with that snippet.
- Migration applies cleanly and is reversible.
- Backfill script runs end-to-end on a seeded test DB.

**Verification.** Service tests; migration test against a fresh DB (`db:migrate`); `check:types`; `build:client`.

---

### T6 — Reverse search (skills → titles by demand)

**Source:** IDEAS.md → "CI-4 — Reverse search".

**Files.**
- `shared/src/utils/normalizeJobTitle.ts` (NEW) — title normalisation utility.
- `shared/src/utils/normalizeJobTitle.test.ts` (NEW).
- `orchestrator/src/server/services/skill-demand-search.ts` (NEW).
- `orchestrator/src/server/services/skill-demand-search.test.ts` (NEW).
- `orchestrator/src/server/api/routes/jobs/read.ts` — add `GET /api/jobs/skill-demand`.
- `orchestrator/src/client/api/jobs.ts` — client function.
- `orchestrator/src/client/lib/queryKeys.ts` — query key.
- `orchestrator/src/client/pages/SkillDemandPage.tsx` (NEW).
- `orchestrator/src/client/App.tsx` — register route.
- `orchestrator/src/client/components/navigation.ts` — add nav entry "Skill Demand".

**Plan.**
1. **Title normalisation.** `normalizeJobTitle(raw): string` — lowercase, strip leading seniority prefixes (regex `/^(senior|junior|principal|staff|lead|sr\.?|jr\.?|chief)\s+/i`), split on `/` and take first segment, trim.
2. **Service.** Pure function `searchSkillDemand({ skills: string[], jobs: JobRow[] }): Array<{ title: string; count: number; avgOverlapPct: number; avgScore: number | null; medianSalaryPLN: number | null; topEmployers: string[] }>`. Compute per-job overlap as `intersection(jobSkills, inputSkills) / inputSkills.length`. Group by normalised title; aggregate. Rank by `avgOverlapPct * Math.log(count + 1)` desc.
3. **Endpoint.** Accepts `?skills=java,kafka,spring`. Splits and trims. Calls service over all tenant-scoped jobs.
4. **Client page.** Pre-filled with user's CV skills (use the same source as the fixed T1 detection). Editable comma-separated input. Debounce 300ms. Render a table with the columns listed above. Each title row links to a filtered job list (use existing `/jobs?title=...` if available, otherwise omit the link for now).
5. **Tests.** Unit-test the normaliser and the service with seeded inputs. Endpoint test using existing test utils.

**Acceptance.**
- Default page load returns ≥10 titles when the tenant has reasonable data.
- Editing the skills input re-ranks within 1s.

**Verification.** Service + util tests; `check:types`; `build:client`.

---

### T7 (stretch) — OE-fitness score

**Source:** IDEAS.md → "OE-1 — OE-fitness score + filter".

**Depends on:** T5 (uses red-flag count as input).

**Files.**
- `orchestrator/src/server/services/oe-fitness.ts` (NEW).
- `orchestrator/src/server/services/oe-fitness.test.ts` (NEW).
- Drizzle migration: add `oe_fitness_score REAL`, `oe_fitness_reasons TEXT` to `jobs`.
- Pipeline wire-up.
- `orchestrator/scripts/backfill-oe-fitness.ts` (NEW).
- UI: badge on JobCard + JobPage; filter on list pages.

**Plan.**
1. Implement scoring rules per IDEAS.md OE-1. Pure function `computeOeFitness(job, redFlags): { score: number; reasons: Reason[] }`.
2. Migration + pipeline + backfill, mirroring T5 structure.
3. Client: badge with tooltip listing `reasons`. Filter control on the orchestrator job list ("OE-fitness ≥ N" with N selectable).
4. Tests: per-rule contribution, full-stack score for a few synthetic jobs.

**Acceptance.** Every job processed has a non-null `oeFitnessScore`. Filter hides jobs below threshold.

**Verification.** Service tests; migration; `check:types`; `build:client`.

---

### T8 (stretch) — Skill ignore list

**Source:** IDEAS.md → "Feature 2 — Persistent per-skill ignore list".

**Files.**
- Drizzle migration: new `skill_exclusions` table.
- Repository + service.
- API: `GET/POST/DELETE /api/skill-exclusions`.
- Client API + query keys.
- `SkillGapPage.tsx`: ignore button per row, "Show ignored (N)" toggle, restore button.
- `getSkillGapStats` filters out excluded skills server-side; returns separate `excludedSkills` array.

**Plan.** Per IDEAS.md Feature 2, page-only scope (does not affect scoring). Tests cover: add/remove flow, KPIs reflect post-exclusion counts, "show ignored" reveals + restore.

**Acceptance.** Listed in IDEAS.md.

**Verification.** Migration; repo + API tests; `check:types`; `build:client`.

---

## Halt conditions

Stop the run and write `REPORT.md` immediately if any of these occur:

- A migration fails to apply on a fresh DB.
- `biome ci .` reports lint errors that aren't from the agent's own changes (suggests dirty starting state).
- Two consecutive tasks hit blockers.
- Disk free drops below 1GB or the test DB file exceeds 500MB.
- Any test run exceeds 10 minutes (likely infinite loop).

Do **not** halt for: a single task being skipped, expected test failures the agent fixed, transient network errors during one-off probes (retry once with backoff, then skip the task).

## REPORT.md format

When the run ends, write `REPORT.md` at the repo root with this structure:

```markdown
# Overnight run report — <ISO date>

Branch: agent/overnight-<date>
Started: <ISO timestamp>
Ended: <ISO timestamp>

## Completed
- T<N> — <task title> — commit <short-sha>
- ...

## Skipped
- T<N> — <task title>
  - Blocker: <one-line summary>
  - Detail: <what was attempted, what failed, file:line references>
  - Suggested next step for human: <one sentence>

## Notable findings
- <any unexpected state, dead-end probes, or things the human should know>

## Next time
- <ordered list of the skipped tasks, plus anything T1-T8 didn't cover>
```

Keep it factual. No marketing language, no emojis, no claims about what "should" work — only what was tried and observed.
