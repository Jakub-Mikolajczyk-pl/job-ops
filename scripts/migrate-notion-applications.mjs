#!/usr/bin/env node
/**
 * One-shot Notion → JobOps salvage migration (RECRUITMENT_TASKS.md R5).
 *
 * Reads the dead "Job Applications" Notion database, writes a CSV backup FIRST
 * (always, even on --dry-run), then POSTs each page to JobOps `/api/ingest` as
 * `source:'notion_migration', kind:'note'` with `meta.archived=true`. The R2
 * worker does the actual extraction/dedup, so migrated rows land as archived
 * cards without polluting the active board. Idempotent: re-running dedups on
 * the content hash, so zero new rows the second time.
 *
 *   NOTION_TOKEN=secret_xxx \
 *   JOBOPS_URL="https://jobops-mine.jakubmikolajczyk.com" \
 *   INGEST_AUTH="Bearer <token>" \              # optional
 *   node scripts/migrate-notion-applications.mjs [--dry-run]
 *
 * Notion DB defaults (overridable via env): database cea1eeed…843.
 */

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_DATABASE_ID = "cea1eeeda656456893ae48a2f0828843";
const NOTION_VERSION = process.env.NOTION_VERSION ?? "2022-06-28";

/** Flatten a single Notion property value to plain text. */
export function notionPropToText(prop) {
  if (!prop || typeof prop !== "object") return "";
  switch (prop.type) {
    case "title":
    case "rich_text":
      return (prop[prop.type] ?? []).map((t) => t.plain_text ?? "").join("");
    case "select":
      return prop.select?.name ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "multi_select":
      return (prop.multi_select ?? []).map((s) => s.name).join(", ");
    case "people":
      return (prop.people ?? []).map((p) => p.name ?? p.id).join(", ");
    case "date":
      return prop.date?.start
        ? prop.date.end
          ? `${prop.date.start} → ${prop.date.end}`
          : prop.date.start
        : "";
    case "number":
      return prop.number == null ? "" : String(prop.number);
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "url":
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "formula":
      return notionPropToText({ type: prop.formula?.type, ...prop.formula });
    default:
      return "";
  }
}

/** Flatten all properties of a page into a { key: text } record. */
export function flattenPage(page) {
  const out = {};
  for (const [key, value] of Object.entries(page.properties ?? {})) {
    const text = notionPropToText(value);
    if (text) out[key] = text;
  }
  return out;
}

/** Serialize a page's salvageable fields into the ingest text body. */
export function serializePage(page) {
  const flat = flattenPage(page);
  const lines = Object.entries(flat).map(([key, value]) => `${key}: ${value}`);
  return lines.join("\n");
}

/** Build a CSV string (header + rows) from flattened page records. */
export function buildCsv(records) {
  const columns = ["notionId"];
  for (const record of records) {
    for (const key of Object.keys(record.fields)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const escapeCsv = (value) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escapeCsv).join(",");
  const rows = records.map((record) =>
    columns
      .map((col) =>
        escapeCsv(
          col === "notionId" ? record.notionId : (record.fields[col] ?? ""),
        ),
      )
      .join(","),
  );
  return [header, ...rows].join("\n");
}

/** Query all pages of a Notion database, following pagination. */
async function fetchAllPages(databaseId, token, fetchImpl = fetch) {
  const pages = [];
  let cursor;
  do {
    const response = await fetchImpl(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Notion query failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    const data = await response.json();
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function postIntake(page, deps) {
  const { baseUrl, authHeader, fetchImpl } = deps;
  const text = serializePage(page);
  if (!text.trim()) return { skipped: true };
  const headers = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetchImpl(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "notion_migration",
      kind: "note",
      text,
      meta: { archived: true, notionId: page.id },
    }),
  });
  if (!response.ok) {
    throw new Error(`ingest failed for ${page.id}: HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => ({}));
  return { deduped: Boolean(body?.data?.deduped) };
}

export async function runMigration(options = {}) {
  const {
    databaseId = process.env.NOTION_DATABASE_ID ?? DEFAULT_DATABASE_ID,
    token = process.env.NOTION_TOKEN,
    baseUrl = process.env.JOBOPS_URL ?? "http://localhost:3001",
    authHeader = process.env.INGEST_AUTH,
    dryRun = false,
    fetchImpl = fetch,
    writeFileImpl = writeFile,
    log = console.log,
  } = options;

  if (!token) throw new Error("NOTION_TOKEN is required");

  const pages = await fetchAllPages(databaseId, token, fetchImpl);
  log(`Fetched ${pages.length} Notion page(s) from ${databaseId}`);

  // Backup FIRST — always, regardless of dry-run.
  const records = pages.map((page) => ({
    notionId: page.id,
    fields: flattenPage(page),
  }));
  const csvPath = `notion-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  await writeFileImpl(csvPath, buildCsv(records), "utf8");
  log(`Wrote backup: ${csvPath}`);

  if (dryRun) {
    log(
      `[dry-run] would POST ${pages.length} page(s) to ${baseUrl}/api/ingest`,
    );
    return { fetched: pages.length, posted: 0, deduped: 0, dryRun: true };
  }

  let posted = 0;
  let deduped = 0;
  for (const page of pages) {
    const result = await postIntake(page, { baseUrl, authHeader, fetchImpl });
    if (result.skipped) continue;
    posted += 1;
    if (result.deduped) deduped += 1;
  }
  log(`Posted ${posted} page(s) (${deduped} deduped) to ${baseUrl}/api/ingest`);
  return { fetched: pages.length, posted, deduped, dryRun: false };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  runMigration({ dryRun }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
