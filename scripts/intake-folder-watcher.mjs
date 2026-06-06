#!/usr/bin/env node
/**
 * Intake folder watcher (RECRUITMENT_TASKS.md R4) — runs on the PC, not the
 * container. Watches INTAKE_DIR for dropped files (Hidock `.txt` transcripts +
 * manual notes), waits until each file is size-stable, then POSTs its contents
 * to JobOps `POST /api/ingest`. On a 2xx the file is renamed `DONE_<name>`; on
 * failure `ERR_<name>` — the rename happens only AFTER the response so a crash
 * mid-flight never loses a file (it stays un-prefixed and is retried).
 *
 * Run on the PC (plain node, no build step):
 *   INTAKE_DIR="F:/Rekruterski dump danych" \
 *   JOBOPS_URL="https://jobops-mine.jakubmikolajczyk.com" \
 *   INGEST_AUTH="Bearer <token>"   # optional; omit if posting via a public route
 *   node scripts/intake-folder-watcher.mjs
 *
 * Schedule via Windows Task Scheduler (periodic or on device-connect).
 */

import { readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".note"]);
const DONE_PREFIX = "DONE_";
const ERR_PREFIX = "ERR_";
const POLL_INTERVAL_MS = 2_000;
const STABLE_CHECKS = 2;

/** Filename prefix hints that override the default classification. */
const PREFIX_HINTS = [
  { prefix: "email_", source: "folder", kind: "recruiter_email" },
  { prefix: "linkedin_", source: "folder", kind: "linkedin_msg" },
  { prefix: "note_", source: "folder", kind: "note" },
  { prefix: "transcript_", source: "hidock", kind: "call_transcript" },
];

/** Files we never touch: already-handled, hidden, or in-flight temp files. */
export function shouldSkip(filename) {
  if (filename.startsWith(DONE_PREFIX) || filename.startsWith(ERR_PREFIX)) {
    return true;
  }
  if (filename.startsWith(".") || filename.startsWith("~")) return true;
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return !TEXT_EXTENSIONS.has(ext);
}

/**
 * Map a filename to an ingest {source, kind}. A prefix hint wins; otherwise a
 * `.txt` is treated as a Hidock call transcript (the folder's primary use),
 * and other text files as a generic folder note. Returns null if unsupported.
 */
export function classifyFile(filename) {
  if (shouldSkip(filename)) return null;
  const lower = filename.toLowerCase();
  for (const hint of PREFIX_HINTS) {
    if (lower.startsWith(hint.prefix)) {
      return { source: hint.source, kind: hint.kind };
    }
  }
  const ext = lower.slice(lower.lastIndexOf("."));
  if (ext === ".txt") {
    return { source: "hidock", kind: "call_transcript" };
  }
  return { source: "folder", kind: "note" };
}

/**
 * Process one file: read it, POST to /api/ingest, then rename DONE_/ERR_.
 * Dependencies (fetch, fs ops) are injectable so the logic is unit-testable.
 * Returns { status: "done" | "error" | "skipped", ... }.
 */
export async function processFile(dir, filename, deps = {}) {
  const {
    baseUrl = process.env.JOBOPS_URL ?? "http://localhost:3001",
    authHeader = process.env.INGEST_AUTH,
    fetchImpl = fetch,
    readFileImpl = readFile,
    renameImpl = rename,
    log = console.log,
  } = deps;

  const classification = classifyFile(filename);
  if (!classification) return { status: "skipped", filename };

  const fullPath = join(dir, filename);
  const text = (await readFileImpl(fullPath, "utf8")).trim();
  if (!text) {
    await renameImpl(fullPath, join(dir, `${ERR_PREFIX}${filename}`));
    return { status: "error", filename, reason: "empty file" };
  }

  let ok = false;
  let reason;
  try {
    const headers = { "Content-Type": "application/json" };
    if (authHeader) headers.Authorization = authHeader;
    const response = await fetchImpl(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: classification.source,
        kind: classification.kind,
        text,
        meta: { filename },
      }),
    });
    ok = response.ok;
    if (!ok) reason = `ingest HTTP ${response.status}`;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }

  // Rename ONLY after the response is known — never before.
  const prefix = ok ? DONE_PREFIX : ERR_PREFIX;
  await renameImpl(fullPath, join(dir, `${prefix}${filename}`));
  log(
    `[intake-watcher] ${ok ? "DONE" : "ERR"} ${filename}${reason ? ` (${reason})` : ""}`,
  );
  return {
    status: ok ? "done" : "error",
    filename,
    ...(reason ? { reason } : {}),
  };
}

/** Wait until a file's size stops changing (debounce slow writers/copies). */
async function waitUntilStable(fullPath, statImpl = stat) {
  let lastSize = -1;
  let stableCount = 0;
  while (stableCount < STABLE_CHECKS) {
    let size;
    try {
      size = (await statImpl(fullPath)).size;
    } catch {
      return false; // file vanished (moved/renamed) — skip.
    }
    if (size === lastSize) {
      stableCount += 1;
    } else {
      stableCount = 0;
      lastSize = size;
    }
    if (stableCount < STABLE_CHECKS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  return true;
}

async function scanOnce(dir) {
  const entries = await readdir(dir);
  for (const filename of entries) {
    if (shouldSkip(filename)) continue;
    const fullPath = join(dir, filename);
    const stable = await waitUntilStable(fullPath);
    if (!stable) continue;
    try {
      await processFile(dir, filename);
    } catch (error) {
      console.error(`[intake-watcher] failed ${filename}:`, error);
    }
  }
}

export async function startWatcher() {
  const dir = process.env.INTAKE_DIR;
  if (!dir) {
    console.error("INTAKE_DIR is required");
    process.exit(1);
  }
  console.log(
    `[intake-watcher] watching ${dir} → ${process.env.JOBOPS_URL ?? "http://localhost:3001"}/api/ingest`,
  );
  // Initial sweep, then poll. Polling (not fs.watch) survives network shares
  // and Task Scheduler restarts, and pairs naturally with the stability check.
  await scanOnce(dir);
  setInterval(() => {
    void scanOnce(dir).catch((error) => {
      console.error("[intake-watcher] scan failed:", error);
    });
  }, POLL_INTERVAL_MS * 3);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void startWatcher();
}
