import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/brag-document", () => ({
  getBragDocument: vi.fn(),
  setSourceUrl: vi.fn(),
  saveSyncResult: vi.fn(),
  saveSyncError: vi.fn(),
}));

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn(),
}));

import * as bragDocRepo from "../repositories/brag-document";
import { getSetting } from "../repositories/settings";
import {
  bragProjectToCatalogItem,
  bragProjectToV5ProjectItem,
  buildBragDocumentSection,
  capBragDocumentForPrompt,
  getBragDocumentProjects,
  parseBragDocumentProjects,
  syncBragDocument,
} from "./brag-document";
import { projectItemSchema } from "./rxresume/schema/v5";

function row(
  over: Partial<{ sourceUrl: string | null; content: string | null }>,
) {
  return {
    tenantId: "tenant_default",
    sourceUrl: null,
    content: null,
    byteSize: null,
    fetchedAt: null,
    lastError: null,
    updatedAt: "2026-06-21T00:00:00.000Z",
    ...over,
  };
}

function mockResponse(init: {
  ok: boolean;
  status?: number;
  statusText?: string;
  text?: string;
}): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    statusText: init.statusText ?? "",
    text: async () => init.text ?? "",
  } as unknown as Response;
}

describe("capBragDocumentForPrompt", () => {
  it("returns empty string for missing or blank content", () => {
    expect(capBragDocumentForPrompt(null)).toBe("");
    expect(capBragDocumentForPrompt(undefined)).toBe("");
    expect(capBragDocumentForPrompt("   \n  ")).toBe("");
  });

  it("returns trimmed content unchanged when within the cap", () => {
    expect(capBragDocumentForPrompt("  - 2026-01-01 - Shipped X  ")).toBe(
      "- 2026-01-01 - Shipped X",
    );
  });

  it("truncates content beyond the cap and marks it", () => {
    const long = "x".repeat(9000);
    const result = capBragDocumentForPrompt(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("[brag document truncated]");
  });
});

describe("buildBragDocumentSection", () => {
  it("returns empty string when there is no content", () => {
    expect(buildBragDocumentSection("")).toBe("");
    expect(buildBragDocumentSection(null)).toBe("");
  });

  it("wraps content with the achievements header", () => {
    const section = buildBragDocumentSection("- 2026-01-01 - Shipped X");
    expect(section).toContain("Brag document");
    expect(section).toContain("Shipped X");
  });
});

describe("syncBragDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(bragDocRepo.getBragDocument).mockResolvedValue(
      row({ sourceUrl: "http://forgejo.test/raw/brag.md" }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and persists content on success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ ok: true, text: "- 2026-01-01 - Did X" }),
      );

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe("http://forgejo.test/raw/brag.md");
    expect(bragDocRepo.saveSyncResult).toHaveBeenCalledWith({
      content: "- 2026-01-01 - Did X",
      byteSize: Buffer.byteLength("- 2026-01-01 - Did X", "utf8"),
      sourceUrl: "http://forgejo.test/raw/brag.md",
    });
    expect(bragDocRepo.saveSyncError).not.toHaveBeenCalled();
  });

  it("sends the read token as an Authorization header", async () => {
    vi.mocked(getSetting).mockResolvedValue("secret-token");
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ ok: true, text: "content" }));

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "token secret-token",
    );
  });

  it("records lastError and preserves content on HTTP failure", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ ok: false, status: 404, statusText: "Not Found" }),
      );

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    expect(bragDocRepo.saveSyncResult).not.toHaveBeenCalled();
    expect(bragDocRepo.saveSyncError).toHaveBeenCalledWith(
      expect.stringContaining("404"),
    );
  });

  it("rejects oversized documents", async () => {
    const huge = "y".repeat(300 * 1024);
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ ok: true, text: huge }));

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    expect(bragDocRepo.saveSyncResult).not.toHaveBeenCalled();
    expect(bragDocRepo.saveSyncError).toHaveBeenCalledWith(
      expect.stringContaining("too large"),
    );
  });

  it("does not fetch when no source URL is configured", async () => {
    vi.mocked(bragDocRepo.getBragDocument).mockResolvedValue(
      row({ sourceUrl: null }),
    );
    const fetchFn = vi.fn();

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(bragDocRepo.saveSyncError).toHaveBeenCalledWith(
      expect.stringContaining("No source URL"),
    );
  });

  it("records lastError when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    await syncBragDocument(fetchFn as unknown as typeof fetch);

    expect(bragDocRepo.saveSyncError).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
  });
});

describe("parseBragDocumentProjects", () => {
  const sample = [
    "# STATE: Brag Document",
    "last_updated: 2026-06-18",
    "",
    "## Usage Notes",
    "- Not a project section.",
    "",
    "## Homelab / Platform",
    "- 2026-06-14 - Built a LAN dashboard.",
    "- 2025-05-01 - Set up DNS failover.",
    "",
    "## Empty Section",
    "",
    "## Second Brain / AI Pipeline",
    "- 2026-06-10 - Simplified the architecture.",
  ].join("\n");

  it("returns one project per section, skipping Usage Notes and empty sections", () => {
    const projects = parseBragDocumentProjects(sample);
    expect(projects.map((p) => p.name)).toEqual([
      "Homelab / Platform",
      "Second Brain / AI Pipeline",
    ]);
  });

  it("slugifies ids and strips date prefixes, most-recent first", () => {
    const [homelab] = parseBragDocumentProjects(sample);
    expect(homelab.id).toBe("brag:homelab-platform");
    expect(homelab.date).toBe("2026-06-14");
    expect(homelab.bullets).toEqual([
      "Built a LAN dashboard.",
      "Set up DNS failover.",
    ]);
  });

  it("derives a period (single year or range) from bullet dates", () => {
    const [homelab, secondBrain] = parseBragDocumentProjects(sample);
    expect(homelab.period).toBe("2025 – 2026");
    expect(secondBrain.period).toBe("2026");
  });

  it("returns empty for blank or missing input", () => {
    expect(parseBragDocumentProjects("")).toEqual([]);
    expect(parseBragDocumentProjects(null)).toEqual([]);
  });
});

describe("getBragDocumentProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads cached content and caps bullets per project", async () => {
    const manyBullets = Array.from(
      { length: 10 },
      (_, i) => `- 2026-01-${String(i + 1).padStart(2, "0")} - Item ${i + 1}`,
    ).join("\n");
    vi.mocked(bragDocRepo.getBragDocument).mockResolvedValue(
      row({ content: `## Homelab\n${manyBullets}` }),
    );

    const projects = await getBragDocumentProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].bullets).toHaveLength(6);
  });
});

describe("brag project mappers", () => {
  const project = {
    id: "brag:homelab",
    name: "Homelab",
    period: "2025 – 2026",
    date: "2026-01-01",
    bullets: ["Did X.", "Did Y."],
  };

  it("maps to a catalog item that is not visible in the base resume", () => {
    expect(bragProjectToCatalogItem(project)).toEqual({
      id: "brag:homelab",
      name: "Homelab",
      description: "Did X.\nDid Y.",
      date: "2025 – 2026",
      isVisibleInBase: false,
    });
  });

  it("maps to a v5 project item that satisfies the resume schema", () => {
    const item = bragProjectToV5ProjectItem(project);
    expect(item).toEqual({
      id: "brag:homelab",
      hidden: false,
      name: "Homelab",
      period: "2025 – 2026",
      website: { url: "", label: "" },
      description: "Did X.\nDid Y.",
    });
    // Guard the injection contract against the real Reactive Resume v5 schema.
    expect(projectItemSchema.safeParse(item).success).toBe(true);
  });
});
