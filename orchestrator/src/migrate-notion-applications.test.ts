/**
 * Unit tests for the one-shot Notion salvage migration (RECRUITMENT_TASKS.md
 * R5). Imports the root .mjs helpers and drives runMigration with injected
 * fetch/fs — no real Notion, no real JobOps, no real disk. Under src/ so
 * vitest's glob picks it up.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildCsv,
  flattenPage,
  notionPropToText,
  runMigration,
  serializePage,
} from "../../scripts/migrate-notion-applications.mjs";

const samplePage = {
  id: "page-1",
  properties: {
    Company: {
      type: "title",
      title: [{ plain_text: "Acme Corp" }],
    },
    Position: {
      type: "rich_text",
      rich_text: [{ plain_text: "Senior Java Dev" }],
    },
    Stage: { type: "status", status: { name: "Applied" } },
    Stack: {
      type: "multi_select",
      multi_select: [{ name: "Java" }, { name: "Spring" }],
    },
    Empty: { type: "rich_text", rich_text: [] },
  },
};

describe("notionPropToText", () => {
  it("flattens common property types", () => {
    expect(
      notionPropToText({ type: "title", title: [{ plain_text: "Hi" }] }),
    ).toBe("Hi");
    expect(
      notionPropToText({
        type: "multi_select",
        multi_select: [{ name: "A" }, { name: "B" }],
      }),
    ).toBe("A, B");
    expect(notionPropToText({ type: "number", number: 42 })).toBe("42");
    expect(notionPropToText({ type: "checkbox", checkbox: true })).toBe("true");
    expect(notionPropToText({ type: "unknown" })).toBe("");
  });
});

describe("serializePage / flattenPage", () => {
  it("drops empty fields and serializes key: value lines", () => {
    const flat = flattenPage(samplePage);
    expect(flat).not.toHaveProperty("Empty");
    const text = serializePage(samplePage);
    expect(text).toContain("Company: Acme Corp");
    expect(text).toContain("Stack: Java, Spring");
    expect(text).not.toContain("Empty:");
  });
});

describe("buildCsv", () => {
  it("builds a header from the union of fields and escapes commas", () => {
    const csv = buildCsv([
      { notionId: "p1", fields: { Company: "Acme, Inc", Stage: "Applied" } },
      { notionId: "p2", fields: { Company: "Beta" } },
    ]);
    const [header, row1] = csv.split("\n");
    expect(header).toBe("notionId,Company,Stage");
    expect(row1).toContain('"Acme, Inc"');
  });
});

describe("runMigration", () => {
  function notionResponse(pages: unknown[]) {
    return {
      ok: true,
      json: async () => ({ results: pages, has_more: false }),
      text: async () => "",
    };
  }

  it("writes a CSV backup and posts each page", async () => {
    const fetchImpl = vi
      .fn()
      // First call: Notion query.
      .mockResolvedValueOnce(notionResponse([samplePage]))
      // Second call: ingest POST.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { deduped: false } }),
      });
    const writeFileImpl = vi.fn().mockResolvedValue(undefined);

    const result = await runMigration({
      token: "secret",
      baseUrl: "http://jobops.test",
      fetchImpl,
      writeFileImpl,
      log: () => {},
    });

    expect(result).toMatchObject({ fetched: 1, posted: 1, deduped: 0 });
    expect(writeFileImpl).toHaveBeenCalledTimes(1);
    const [csvPath, csvBody] = writeFileImpl.mock.calls[0];
    expect(String(csvPath)).toMatch(/^notion-backup-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(String(csvBody)).toContain("Acme Corp");
    // Second fetch call is the ingest POST.
    const ingestCall = fetchImpl.mock.calls[1];
    expect(ingestCall[0]).toBe("http://jobops.test/api/ingest");
    const payload = JSON.parse(ingestCall[1].body);
    expect(payload.source).toBe("notion_migration");
    expect(payload.meta).toMatchObject({ archived: true, notionId: "page-1" });
  });

  it("dry-run writes the CSV but posts nothing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(notionResponse([samplePage]));
    const writeFileImpl = vi.fn().mockResolvedValue(undefined);

    const result = await runMigration({
      token: "secret",
      dryRun: true,
      fetchImpl,
      writeFileImpl,
      log: () => {},
    });

    expect(result).toMatchObject({ fetched: 1, posted: 0, dryRun: true });
    expect(writeFileImpl).toHaveBeenCalledTimes(1);
    // Only the Notion query happened — no ingest POST.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws without a Notion token", async () => {
    await expect(
      runMigration({ token: undefined, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/NOTION_TOKEN/);
  });
});
