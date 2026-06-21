# 1. Pull the brag document from Forgejo (raw file), rather than push or paste

Date: 2026-06-21

Status: Accepted

## Context

The brain-memory project maintains a "brag document" — a curated, append-only bullet bank
of dated accomplishments — explicitly intended to feed CV tailoring in JobOps. JobOps needs
that text as a supplementary input to its CV-authoring prompts (Tailoring, Ghostwriter, and
the Resume Studio field assistant).

Constraints:

- brain-memory is a **static git repository on Forgejo**; it exposes **no HTTP API and no MCP**.
- JobOps runs **deployed (CT104)** and is tested against the deployed instance; the deployed
  app has no access to the developer's local checkout path.
- brain-memory and JobOps share a LAN; the brag document changes **deliberately** (curated
  via PR into `master`), not constantly.

## Decision

JobOps **pulls** the raw markdown over HTTP from Forgejo's raw-file endpoint, authenticated
with a stored read token, and caches it per-tenant in a dedicated `brag_document` table. A
daily scheduler plus a manual "Sync now" button refresh the cache. The cached content is
injected — whole, char-capped — into the three CV-authoring prompts via a single shared
`getBragDocumentPromptSection()` helper.

Alternatives considered:

- **Push from brain-memory** (a nightly agent POSTs to a JobOps endpoint): auto-fresh and
  keeps brain-memory as orchestrator, but requires building and scheduling work in
  brain-memory — outside the scope of a JobOps-side integration.
- **Manual paste** into a setting: simplest, but defeats the "living document flows in"
  intent and goes stale.
- **Git clone/pull** inside JobOps: needs a git binary, a working copy, and clone/pull
  plumbing for the same result as a single HTTP GET.

## Consequences

- JobOps takes a coupling to Forgejo's raw-file URL shape and needs a Forgejo read token
  (secret setting / `BRAG_DOC_SOURCE_TOKEN`). If brain-memory later grows a real API or MCP,
  the transport can be swapped behind `syncBragDocument()` without touching the prompt code.
- No changes to brain-memory are required.
- A failed fetch keeps the last good cached content and surfaces `lastError` in Settings,
  so CV generation is never blocked by Forgejo being unavailable.
