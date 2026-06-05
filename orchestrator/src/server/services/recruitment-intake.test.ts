import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "../api/routes/test-utils";

// Mutable extraction the mocked LLM returns; set per test.
const h = vi.hoisted(() => ({ extraction: null as unknown }));

vi.mock("./modelSelection", () => ({
	resolveLlmModel: async () => "mock-model",
	createConfiguredLlmService: async () => ({
		callJson: async () => ({ success: true, data: h.extraction }),
	}),
}));

describe.sequential("Recruitment intake worker (R2)", () => {
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

	async function ingest(body: Record<string, unknown>): Promise<string> {
		const res = await fetch(`${baseUrl}/api/ingest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const json = await res.json();
		return json.data.intakeId as string;
	}

	async function process(id: string) {
		const res = await fetch(`${baseUrl}/api/ingest/${id}/process`, {
			method: "POST",
		});
		return (await res.json()).data;
	}

	it("creates a job + stage from a LinkedIn message", async () => {
		h.extraction = {
			isRecruitment: true,
			company: "Acme Corp",
			position: "Senior Java Developer",
			stage: "recruiter_screen",
			salaryRange: "20000-24000 PLN netto B2B",
			workModel: "Remote",
			techStack: ["Java", "Spring", "Kafka"],
			priority: "high",
			nextAction: "Reply to recruiter with CV",
			nextActionDue: "2026-06-10",
			flags: "🟢 remote, good rate | 🔴 short contract",
		};
		const id = await ingest({
			source: "telegram",
			kind: "linkedin_msg",
			text: "Recruiter reached out about a Senior Java role at Acme.",
		});
		const result = await process(id);
		expect(result.action).toBe("created");
		expect(typeof result.jobId).toBe("string");
	});

	it("is idempotent: re-processing a done row is skipped", async () => {
		h.extraction = {
			isRecruitment: true,
			company: "Beta Ltd",
			position: "Backend Engineer",
			stage: "applied",
		};
		const id = await ingest({
			source: "telegram",
			kind: "note",
			text: "Applied to Beta Ltd backend role.",
		});
		const first = await process(id);
		expect(first.action).toBe("created");
		const second = await process(id);
		expect(second.action).toBe("skipped");
	});

	it("flags needs_review when company/position is missing", async () => {
		h.extraction = {
			isRecruitment: true,
			company: "",
			position: "",
			stage: "applied",
		};
		const id = await ingest({
			source: "folder",
			kind: "note",
			text: "Vague note with no company.",
		});
		const result = await process(id);
		expect(result.action).toBe("needs_review");
	});

	it("drops a non-recruitment call transcript", async () => {
		h.extraction = {
			isRecruitment: false,
			company: "",
			position: "",
			stage: "applied",
		};
		const id = await ingest({
			source: "hidock",
			kind: "call_transcript",
			text: "Cześć, witam w kolejnym odcinku filmu...",
		});
		const result = await process(id);
		expect(result.action).toBe("skipped_non_recruitment");
	});

	it("creates a job and records study-topics from a tech interview", async () => {
		h.extraction = {
			isRecruitment: true,
			company: "Gamma Tech",
			position: "Platform Engineer",
			stage: "technical_interview",
			isTechInterview: true,
			studyTopics: ["Kubernetes operators", "Postgres MVCC"],
			hesitations: ["explaining CAP theorem"],
			concepts: ["raft", "sharding"],
			priority: "high",
		};
		const id = await ingest({
			source: "hidock",
			kind: "call_transcript",
			text: "Long technical interview transcript about distributed systems.",
		});
		const result = await process(id);
		expect(result.action).toBe("created");
		expect(typeof result.jobId).toBe("string");
	});

	it("drains pending rows via process-pending", async () => {
		h.extraction = {
			isRecruitment: true,
			company: "Delta Inc",
			position: "SRE",
			stage: "applied",
		};
		await ingest({ source: "telegram", kind: "note", text: "Delta SRE role." });
		await ingest({ source: "folder", kind: "note", text: "Another Delta note." });
		const res = await fetch(`${baseUrl}/api/ingest/process-pending`, {
			method: "POST",
		});
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.data.processed).toBeGreaterThanOrEqual(2);
	});
});
