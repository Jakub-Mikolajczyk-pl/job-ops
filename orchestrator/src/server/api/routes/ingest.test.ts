import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Ingest API routes", () => {
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

	function post(body: unknown) {
		return fetch(`${baseUrl}/api/ingest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	const sample = {
		source: "telegram",
		kind: "linkedin_msg",
		text: "Cześć, mam ofertę na Senior Java Developer, 20k netto B2B, w pełni zdalnie.",
	};

	it("records a new intake row and returns 201", async () => {
		const res = await post(sample);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.data.deduped).toBe(false);
		expect(typeof body.data.intakeId).toBe("string");
		expect(body.data.intakeId.length).toBeGreaterThan(0);
	});

	it("dedups identical text on the second POST (same intakeId)", async () => {
		const first = await (await post(sample)).json();
		const second = await post(sample);
		expect(second.status).toBe(200);
		const body = await second.json();
		expect(body.data.deduped).toBe(true);
		expect(body.data.intakeId).toBe(first.data.intakeId);
	});

	it("treats whitespace/case-only differences as duplicates", async () => {
		const first = await (await post(sample)).json();
		const variant = {
			...sample,
			text: `  ${sample.text.toUpperCase()}  \n`,
		};
		const body = await (await post(variant)).json();
		expect(body.data.deduped).toBe(true);
		expect(body.data.intakeId).toBe(first.data.intakeId);
	});

	it("rejects an unknown source with 400", async () => {
		const res = await post({ ...sample, source: "carrier-pigeon" });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	it("rejects empty text with 400", async () => {
		const res = await post({ ...sample, text: "   " });
		expect(res.status).toBe(400);
	});
});
