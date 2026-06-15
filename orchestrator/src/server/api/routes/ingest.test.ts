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

	it("accepts telegram_brain_intake as a valid source", async () => {
		const res = await post({
			source: "telegram_brain_intake",
			kind: "linkedin_msg",
			text: "Senior Platform Engineer, remote B2B, recruiter reached out on Telegram.",
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.data.deduped).toBe(false);
	});

	it("returns a protected recruitment intake dashboard with previews and grouped counts", async () => {
		process.env.JOBOPS_DASHBOARD_TOKEN = "dashboard-token";

		const firstText =
			"Senior Backend Engineer, remote, B2B. Confidential recruiter notes should stay private. " +
			"x".repeat(700);
		const secondText = "Short duplicate-safe intake for review queue.";
		const first = await (await post({
			source: "telegram_brain_intake",
			kind: "linkedin_msg",
			text: firstText,
			meta: { strategy: "recruitment_offer", inputMode: "telegram_text" },
		})).json();
		const second = await (await post({
			source: "telegram",
			kind: "note",
			text: secondText,
			meta: { strategy: "recruitment_offer", inputMode: "telegram_text" },
		})).json();

		const { db, schema } = await import("@server/db");
		const { and, eq } = await import("drizzle-orm");
		await db
			.update(schema.rawIntake)
			.set({ status: "processed", processedAt: "2026-06-14T08:00:00.000Z" })
			.where(and(eq(schema.rawIntake.id, first.data.intakeId)));
		await db
			.update(schema.rawIntake)
			.set({ status: "needs_review", errorMessage: "missing company or position" })
			.where(and(eq(schema.rawIntake.id, second.data.intakeId)));

		const unauthorized = await fetch(`${baseUrl}/api/ingest/dashboard`);
		expect(unauthorized.status).toBe(401);

		const response = await fetch(`${baseUrl}/api/ingest/dashboard`, {
			headers: { authorization: "Bearer dashboard-token" },
		});
		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body.ok).toBe(true);
		expect(body.data.counts).toMatchObject({
			pending: 0,
			needsReview: 1,
			processed: 1,
			error: 0,
		});
		expect(body.data.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: first.data.intakeId,
					source: "telegram_brain_intake",
					status: "processed",
					rawTextPreview: firstText.slice(0, 500),
				}),
				expect.objectContaining({
					id: second.data.intakeId,
					source: "telegram",
					status: "needs_review",
					error: "missing company or position",
					rawTextPreview: secondText,
				}),
			]),
		);
		expect(
			body.data.items.some((item: { rawTextPreview: string }) =>
				item.rawTextPreview.includes("x".repeat(600)),
			),
		).toBe(false);
	});
});
