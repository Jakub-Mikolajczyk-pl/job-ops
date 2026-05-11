# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is JobOps

JobOps is a self-hosted job-hunting platform. It searches 10+ job boards, scores each result against a user profile, tailors CVs with AI, tracks applications, and watches Gmail for recruiter replies. It is multi-tenant (each user = a workspace/tenant).

## Commands

### Development

```bash
npm ci                                        # install all workspace deps
npm --workspace orchestrator run db:migrate   # create/migrate SQLite database
npm --workspace orchestrator run dev          # run server (port 3001) + Vite client (port 5173) concurrently
npm run docs:dev                              # docs site on port 3006
```

### CI-parity checks (run all before any PR)

```bash
./orchestrator/node_modules/.bin/biome ci .       # lint + format check
npm run check:types:shared                         # shared package types
npm --workspace orchestrator run check:types       # orchestrator types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client      # Vite production build
npm --workspace orchestrator run test:run          # Vitest unit tests
```

If tests fail with a `better-sqlite3` Node ABI mismatch:
```bash
npm --workspace orchestrator rebuild better-sqlite3
```

CI targets Node 22. The repo pins Node via Volta (`"node": "22.22.1"` in root `package.json`).

### Targeted test run

```bash
npm --workspace orchestrator run test -- --reporter=verbose path/to/file.test.ts
```

### Formatting

```bash
npm run format:all   # auto-fix formatting with Biome (from repo root)
```

### Pipeline (one-off)

```bash
npm --workspace orchestrator run pipeline:run          # interactive (with browser UI for CAPTCHA)
npm --workspace orchestrator run pipeline:run:headless # headless
```

### Database utilities

```bash
npm --workspace orchestrator run db:clear   # wipe data, keep schema
npm --workspace orchestrator run db:drop    # drop all tables
```

## Architecture

### Repository layout

```
job-ops-src/
├── orchestrator/          # Main app — Express API + Vite/React SPA
│   └── src/
│       ├── server/        # Express backend
│       └── client/        # React frontend
├── shared/                # Types, extractors metadata, utilities shared by all workspaces
├── extractors/            # One npm workspace per job-board (adzuna, hiringcafe, gradcracker, …)
├── visa-sponsor-providers/
└── docs-site/             # Docusaurus
```

### Orchestrator server (`orchestrator/src/server/`)

| Directory | Role |
|-----------|------|
| `api/routes/` | Express route handlers, one file per domain (`jobs/`, `pipeline.ts`, `settings.ts`, …) |
| `db/` | Drizzle ORM schema (`schema.ts`) + migration runner (`migrate.ts`). SQLite via `better-sqlite3`. |
| `repositories/` | Thin data-access layer over Drizzle tables, scoped by tenant. |
| `services/` | Business logic (PDF gen, ghostwriter, scoring, tailoring, LLM, post-application, …). |
| `pipeline/` | The orchestration engine — discover → score → select → import → process → tailor steps. |
| `infra/` | Cross-cutting concerns: `logger.ts`, `errors.ts`, `sse.ts`, `job-queue.ts`, `sanitize.ts`, `request-context.ts`. |
| `tenancy/` | Multi-tenant context; `getActiveTenantId()` reads from `AsyncLocalStorage`. |
| `extractors/` | Registry and discovery for extractor manifests (not the extractors themselves). |
| `auth/` | JWT-based auth, session management. |

### Orchestrator client (`orchestrator/src/client/`)

React 18 + React Router v7 + TanStack Query. Vite serves the SPA in dev; in production the Express server serves the built `dist/`.

Key pages: `OrchestratorPage` (pipeline trigger), `JobPage` (job detail + sidebar), `DesignResumePage`, `TrackingInboxPage`, `SettingsPage`.

### Extractor workspaces (`extractors/*/`)

Each job board is an isolated npm workspace that exports a manifest and runner. The orchestrator discovers manifests at startup via `extractors/registry.ts` → `extractors/discovery.ts`. Adding a new extractor requires updating `docker-compose.yml`, `Dockerfile`, and `orchestrator/src/server/extractors/deployment.test.ts`.

### Shared package (`shared/src/`)

Types (`types/`), extractor source IDs/metadata (`extractors/`), location utilities, settings schema, and prompt template definitions. Consumed by all workspaces. Do not import from `shared` using relative paths — use the `@shared/*` alias.

### Multi-tenancy

Every DB read/write, cache, in-memory state, file path, and SSE stream must be scoped to a tenant. `getActiveTenantId()` (`server/tenancy/context.ts`) is the canonical accessor; it reads from `AsyncLocalStorage` set by the request middleware. The default (and currently only) tenant is `tenant_default`.

### LLM service

`services/llm/service.ts` — provider-agnostic; configured via `LLM_PROVIDER` env var. Supports OpenAI, OpenRouter, Google Gemini, and Codex (local Docker sidecar). All AI calls (scoring, tailoring, ghostwriter, summary) go through this service.

### Pipeline flow

1. **discoverJobsStep** — calls extractor runners to scrape job boards
2. **scoreJobsStep** — LLM rates each job 0–100 against user profile
3. **selectJobsStep** — filters by `minSuitabilityScore`, picks top N
4. **importJobsStep** — persists selected jobs into the DB
5. **processJobsStep** — generates AI tailoring (summary, CV rewrite, PDF)
6. **notifyPipelineWebhookStep** — fires webhooks

State is per-tenant, held in `orchestrator.ts` module-level maps. SSE events stream progress to the client via `infra/sse.ts`.

## Path aliases

| Alias | Resolves to |
|-------|-------------|
| `@server/*` | `orchestrator/src/server/*` |
| `@infra/*` | `orchestrator/src/server/infra/*` |
| `@client/*` / `@/*` | `orchestrator/src/client/*` |
| `@shared/*` | `shared/src/*` |

Biome enforces these — using relative `../../` imports across these boundaries is a lint error.

## API contract

All `/api/*` responses must follow:
- Success: `{ ok: true, data, meta?: { requestId } }`
- Error: `{ ok: false, error: { code, message, details? }, meta: { requestId } }`

Use `AppError` from `@infra/errors` with the standard status/code pairs (400 `INVALID_REQUEST`, 401 `UNAUTHORIZED`, 404 `NOT_FOUND`, 500 `INTERNAL_ERROR`, etc.).

Every request/response must carry an `x-request-id` header and include `requestId` in the response `meta`. Propagate `pipelineRunId` / `jobId` into async log context.

## Logging

Use `logger` from `@infra/logger` everywhere in server code. No `console.log/warn/error` in core paths. Log structured objects; redact sensitive keys (`authorization`, `token`, `apiKey`, `password`, …) using `sanitize.ts`.

## SSE

Server: `@infra/sse.ts` helpers for setup, heartbeats, and writes.
Client: `@client/lib/sse.ts` for subscription/event plumbing.
Never duplicate raw SSE setup when these helpers apply.

## Testing conventions

Tests live alongside source files as `*.test.ts` / `*.test.tsx`. Uses Vitest. Test utilities are in `orchestrator/src/server/api/test-utils.ts` and `orchestrator/src/client/test/`. Integration tests hit the real SQLite DB, not mocks.
