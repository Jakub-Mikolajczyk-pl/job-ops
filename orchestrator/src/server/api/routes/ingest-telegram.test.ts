import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Telegram ingest webhook", () => {
	let server: Server;
	let baseUrl: string;
	let closeDb: () => void;
	let tempDir: string;

	beforeEach(async () => {
		({ server, baseUrl, closeDb, tempDir } = await startServer());
	});

	afterEach(async () => {
		// biome-ignore lint/performance/noDelete: test cleanup of env var
		delete process.env.TELEGRAM_WEBHOOK_SECRET;
		await stopServer({ server, closeDb, tempDir });
	});

	function tg(body: unknown, headers: Record<string, string> = {}) {
		return fetch(`${baseUrl}/api/ingest/telegram`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		});
	}

	const message = (text: string) => ({
		update_id: 1,
		message: { message_id: 42, chat: { id: 7 }, text },
	});

	it("records a message when no secret is configured", async () => {
		const res = await tg(message("Recruiter from Acme about a Java role"));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.deduped).toBe(false);
		expect(typeof body.data.intakeId).toBe("string");
	});

	it("accepts a matching secret header", async () => {
		process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
		const res = await tg(message("Some recruiter note"), {
			"X-Telegram-Bot-Api-Secret-Token": "s3cr3t",
		});
		expect(res.status).toBe(201);
	});

	it("rejects a wrong secret with 403", async () => {
		process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
		const res = await tg(message("Should be blocked"), {
			"X-Telegram-Bot-Api-Secret-Token": "wrong",
		});
		expect(res.status).toBe(403);
	});

	it("acks a non-text update with 200 ignored", async () => {
		const res = await tg({ update_id: 2, message: { message_id: 1, chat: { id: 7 } } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.ignored).toBe(true);
	});

	it("dedups identical messages", async () => {
		const first = await (await tg(message("dup text"))).json();
		const second = await tg(message("dup text"));
		const body = await second.json();
		expect(body.data.deduped).toBe(true);
		expect(body.data.intakeId).toBe(first.data.intakeId);
	});
});
