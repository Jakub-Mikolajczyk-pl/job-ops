import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Brag Document API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns an empty status by default", async () => {
    const res = await fetch(`${baseUrl}/api/brag-document`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.bragDocument.hasContent).toBe(false);
    expect(body.data.bragDocument.sourceUrl).toBeNull();
    expect(body.data.bragDocument.hasToken).toBe(false);
  });

  it("persists the source URL and token via PUT /source", async () => {
    const put = await fetch(`${baseUrl}/api/brag-document/source`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: "http://forgejo.test/raw/brag.md",
        token: "secret-token",
      }),
    });
    const putBody = await put.json();
    expect(put.status).toBe(200);
    expect(putBody.data.bragDocument.sourceUrl).toBe(
      "http://forgejo.test/raw/brag.md",
    );
    expect(putBody.data.bragDocument.hasToken).toBe(true);

    const get = await (await fetch(`${baseUrl}/api/brag-document`)).json();
    expect(get.data.bragDocument.sourceUrl).toBe(
      "http://forgejo.test/raw/brag.md",
    );
    expect(get.data.bragDocument.hasToken).toBe(true);
  });

  it("rejects an over-long source URL", async () => {
    const res = await fetch(`${baseUrl}/api/brag-document/source`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl: "x".repeat(3000) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
