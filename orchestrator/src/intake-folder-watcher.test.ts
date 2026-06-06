/**
 * Unit tests for the PC-side intake folder watcher (RECRUITMENT_TASKS.md R4).
 * The script is a standalone .mjs at the repo root; we import its pure helpers
 * and exercise classify + rename with injected fetch/fs (no real filesystem,
 * no network). Lives under src/ so vitest's glob picks it up.
 */

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  classifyFile,
  processFile,
  shouldSkip,
} from "../../scripts/intake-folder-watcher.mjs";

describe("classifyFile", () => {
  it("treats a .txt as a Hidock call transcript by default", () => {
    expect(classifyFile("2026-06-05_call.txt")).toEqual({
      source: "hidock",
      kind: "call_transcript",
    });
  });

  it("honors filename prefix hints", () => {
    expect(classifyFile("email_acme.txt")).toEqual({
      source: "folder",
      kind: "recruiter_email",
    });
    expect(classifyFile("linkedin_msg.md")).toEqual({
      source: "folder",
      kind: "linkedin_msg",
    });
  });

  it("classifies other text files as folder notes", () => {
    expect(classifyFile("scratch.md")).toEqual({
      source: "folder",
      kind: "note",
    });
  });

  it("skips already-processed and unsupported files", () => {
    expect(classifyFile("DONE_call.txt")).toBeNull();
    expect(classifyFile("ERR_call.txt")).toBeNull();
    expect(classifyFile("recording.wav")).toBeNull();
    expect(shouldSkip(".hidden.txt")).toBe(true);
  });
});

describe("processFile", () => {
  function deps(overrides: Record<string, unknown> = {}) {
    return {
      baseUrl: "http://jobops.test",
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
      readFileImpl: vi.fn().mockResolvedValue("Recruiter called about a role."),
      renameImpl: vi.fn().mockResolvedValue(undefined),
      log: () => {},
      ...overrides,
    };
  }

  it("POSTs to /api/ingest and renames DONE_ on 2xx", async () => {
    const d = deps();
    const result = await processFile("/intake", "call.txt", d);
    expect(result.status).toBe("done");
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetchImpl.mock.calls[0];
    expect(url).toBe("http://jobops.test/api/ingest");
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.source).toBe("hidock");
    expect(payload.kind).toBe("call_transcript");
    expect(d.renameImpl).toHaveBeenCalledWith(
      join("/intake", "call.txt"),
      join("/intake", "DONE_call.txt"),
    );
  });

  it("renames ERR_ when ingest fails, and only after the response", async () => {
    const d = deps({
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    });
    const result = await processFile("/intake", "call.txt", d);
    expect(result.status).toBe("error");
    // Rename happened, and strictly after fetch resolved.
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.renameImpl).toHaveBeenCalledWith(
      join("/intake", "call.txt"),
      join("/intake", "ERR_call.txt"),
    );
  });

  it("renames ERR_ when fetch throws (downstream down)", async () => {
    const d = deps({
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const result = await processFile("/intake", "note_x.md", d);
    expect(result.status).toBe("error");
    expect(d.renameImpl).toHaveBeenCalledWith(
      join("/intake", "note_x.md"),
      join("/intake", "ERR_note_x.md"),
    );
  });

  it("skips files it cannot classify without calling fetch", async () => {
    const d = deps();
    const result = await processFile("/intake", "video.mp4", d);
    expect(result.status).toBe("skipped");
    expect(d.fetchImpl).not.toHaveBeenCalled();
    expect(d.renameImpl).not.toHaveBeenCalled();
  });

  it("errors out an empty file without POSTing", async () => {
    const d = deps({ readFileImpl: vi.fn().mockResolvedValue("   \n") });
    const result = await processFile("/intake", "call.txt", d);
    expect(result.status).toBe("error");
    expect(d.fetchImpl).not.toHaveBeenCalled();
    expect(d.renameImpl).toHaveBeenCalledWith(
      join("/intake", "call.txt"),
      join("/intake", "ERR_call.txt"),
    );
  });
});
