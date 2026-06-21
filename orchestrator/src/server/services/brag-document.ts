/**
 * Brag Document service — fetches the external achievement bullet bank from
 * brain-memory (Forgejo raw file + read token), caches it per-tenant, and exposes
 * the cached content as a supplementary block for the CV-authoring prompts.
 *
 * Transport: HTTP GET of a raw markdown file with `Authorization: token <token>`.
 * The token is a secret in the settings registry (DB value or BRAG_DOC_SOURCE_TOKEN
 * env). The editable source URL and the cached content live in the brag_document table.
 */

import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import * as bragDocRepo from "@server/repositories/brag-document";
import * as settingsRepo from "@server/repositories/settings";
import { createScheduler } from "@server/utils/scheduler";
import { getOriginalEnvValue, normalizeEnvInput } from "./envSettings";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCH_BYTES = 256 * 1024; // reject anything larger than 256 KB
const PROMPT_CHAR_CAP = 8000; // keep the injected block bounded (cf. MAX_CONTEXT_CHARS)
const SYNC_HOUR_UTC = 3;
const PROMPT_BLOCK_HEADER =
  "Brag document (real, dated achievements — draw on the relevant ones; do not invent):";

export interface BragDocumentStatus {
  hasContent: boolean;
  byteSize: number | null;
  fetchedAt: string | null;
  lastError: string | null;
  sourceUrl: string | null;
  hasToken: boolean;
}

async function resolveSourceToken(): Promise<string | null> {
  const stored = await settingsRepo.getSetting("bragDocSourceToken");
  return normalizeEnvInput(
    stored ?? getOriginalEnvValue("BRAG_DOC_SOURCE_TOKEN"),
  );
}

export async function getBragDocumentStatus(): Promise<BragDocumentStatus> {
  const [row, token] = await Promise.all([
    bragDocRepo.getBragDocument(),
    resolveSourceToken(),
  ]);
  return {
    hasContent: Boolean(row?.content && row.content.trim().length > 0),
    byteSize: row?.byteSize ?? null,
    fetchedAt: row?.fetchedAt ?? null,
    lastError: row?.lastError ?? null,
    sourceUrl: row?.sourceUrl ?? null,
    hasToken: Boolean(token),
  };
}

export async function setBragDocumentSource(
  sourceUrl: string | null,
): Promise<void> {
  const trimmed = sourceUrl?.trim();
  await bragDocRepo.setSourceUrl(trimmed ? trimmed : null);
}

/**
 * Pull the latest brag document from the configured source. Never throws: on any
 * failure it records `lastError` and preserves the last good cached content.
 */
export async function syncBragDocument(
  fetchFn: typeof fetch = fetch,
): Promise<BragDocumentStatus> {
  const row = await bragDocRepo.getBragDocument();
  const sourceUrl = row?.sourceUrl?.trim();
  if (!sourceUrl) {
    await bragDocRepo.saveSyncError("No source URL configured.");
    return getBragDocumentStatus();
  }

  const token = await resolveSourceToken();
  try {
    const headers: Record<string, string> = { Accept: "text/plain, */*" };
    if (token) headers.Authorization = `token ${token}`;

    const response = await fetchFn(sourceUrl, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      await bragDocRepo.saveSyncError(
        `Fetch failed: HTTP ${response.status} ${response.statusText}`.trim(),
      );
      logger.warn("Brag document sync failed", { status: response.status });
      return getBragDocumentStatus();
    }

    const text = await response.text();
    const byteSize = Buffer.byteLength(text, "utf8");
    if (byteSize > MAX_FETCH_BYTES) {
      await bragDocRepo.saveSyncError(
        `Document too large (${byteSize} bytes; max ${MAX_FETCH_BYTES}).`,
      );
      return getBragDocumentStatus();
    }
    if (!text.trim()) {
      await bragDocRepo.saveSyncError("Fetched document is empty.");
      return getBragDocumentStatus();
    }

    await bragDocRepo.saveSyncResult({ content: text, byteSize, sourceUrl });
    logger.info("Brag document synced", { byteSize });
    return getBragDocumentStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await bragDocRepo.saveSyncError(`Fetch error: ${message}`);
    logger.warn("Brag document sync threw", {
      error: sanitizeUnknown(error),
    });
    return getBragDocumentStatus();
  }
}

/** Pure: trim + cap content for prompt injection, or "" when blank. */
export function capBragDocumentForPrompt(
  content: string | null | undefined,
): string {
  const trimmed = content?.trim();
  if (!trimmed) return "";
  if (trimmed.length <= PROMPT_CHAR_CAP) return trimmed;
  return `${trimmed.slice(0, PROMPT_CHAR_CAP)}\n…[brag document truncated]`;
}

/** Pure: ready-to-inject block (header + capped content), or "". */
export function buildBragDocumentSection(
  content: string | null | undefined,
): string {
  const capped = capBragDocumentForPrompt(content);
  if (!capped) return "";
  return `${PROMPT_BLOCK_HEADER}\n${capped}`;
}

/** Cached brag-doc content, trimmed and capped for prompt injection (or ""). */
export async function getBragDocumentForPrompt(): Promise<string> {
  try {
    const row = await bragDocRepo.getBragDocument();
    return capBragDocumentForPrompt(row?.content);
  } catch (error) {
    logger.warn("Failed to load brag document for prompt", {
      error: sanitizeUnknown(error),
    });
    return "";
  }
}

/**
 * Ready-to-inject prompt block (header + capped content), or "" when there is no
 * brag document. Shared by all three CV-authoring surfaces.
 */
export async function getBragDocumentPromptSection(): Promise<string> {
  try {
    const row = await bragDocRepo.getBragDocument();
    return buildBragDocumentSection(row?.content);
  } catch (error) {
    logger.warn("Failed to load brag document section", {
      error: sanitizeUnknown(error),
    });
    return "";
  }
}

const scheduler = createScheduler("brag-document-sync", async () => {
  await syncBragDocument();
});

export function startBragDocumentSyncScheduler(): void {
  scheduler.start(SYNC_HOUR_UTC);
}
