import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";
import { getSkillTrends } from "./skill-snapshots";

const { skillWatchlist, jobs } = schema;

export interface WatchlistEntry {
	id: string;
	skill: string;
	label: string | null;
	titlePattern: string | null;
	alertOnDrop: boolean;
	alertOnRise: boolean;
	dropThresholdPct: number;
	riseThresholdPct: number;
	notes: string | null;
	pendingMatchCount: number;
	lastMatchAt: string | null;
	createdAt: string;
	trend: Array<{ week: string; count: number }>;
	latestCount: number;
	delta: number;
}

export async function getWatchlist(): Promise<{
	entries: WatchlistEntry[];
	totalPending: number;
}> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(skillWatchlist)
		.where(eq(skillWatchlist.tenantId, tenantId))
		.orderBy(skillWatchlist.createdAt);

	const trends = await getSkillTrends(8);
	const trendBySkill = new Map(trends.map((t) => [t.skill, t]));

	const entries: WatchlistEntry[] = rows.map((row) => {
		const trend = trendBySkill.get(row.skill.toLowerCase());
		return {
			id: row.id,
			skill: row.skill,
			label: row.label ?? null,
			titlePattern: row.titlePattern ?? null,
			alertOnDrop: row.alertOnDrop ?? false,
			alertOnRise: row.alertOnRise ?? false,
			dropThresholdPct: row.dropThresholdPct ?? 30,
			riseThresholdPct: row.riseThresholdPct ?? 30,
			notes: row.notes ?? null,
			pendingMatchCount: row.pendingMatchCount ?? 0,
			lastMatchAt: row.lastMatchAt ?? null,
			createdAt: row.createdAt,
			trend: trend?.weeks ?? [],
			latestCount: trend?.latestCount ?? 0,
			delta: trend?.delta ?? 0,
		};
	});

	const totalPending = entries.reduce((sum, e) => sum + e.pendingMatchCount, 0);
	return { entries, totalPending };
}

export async function addWatchlistEntry(input: {
	skill: string;
	label?: string;
	titlePattern?: string;
	notes?: string;
}): Promise<void> {
	const tenantId = getActiveTenantId();
	const skillLower = input.skill.toLowerCase().trim();
	await db
		.delete(skillWatchlist)
		.where(
			and(
				eq(skillWatchlist.tenantId, tenantId),
				eq(skillWatchlist.skill, skillLower),
			),
		);
	await db.insert(skillWatchlist).values({
		id: randomUUID(),
		tenantId,
		skill: skillLower,
		label: input.label ?? null,
		titlePattern: input.titlePattern ?? null,
		notes: input.notes ?? null,
		createdAt: new Date().toISOString(),
	});
}

export async function removeWatchlistEntry(skill: string): Promise<void> {
	const tenantId = getActiveTenantId();
	await db
		.delete(skillWatchlist)
		.where(
			and(
				eq(skillWatchlist.tenantId, tenantId),
				eq(skillWatchlist.skill, skill.toLowerCase().trim()),
			),
		);
}

export async function markAllSeen(): Promise<void> {
	const tenantId = getActiveTenantId();
	await db
		.update(skillWatchlist)
		.set({ pendingMatchCount: 0 })
		.where(eq(skillWatchlist.tenantId, tenantId));
}

export async function checkWatchlistMatches(sinceIso: string): Promise<number> {
	const tenantId = getActiveTenantId();
	const entries = await db
		.select()
		.from(skillWatchlist)
		.where(eq(skillWatchlist.tenantId, tenantId));
	if (entries.length === 0) return 0;

	const newJobs = await db
		.select({ id: jobs.id, skills: jobs.skills, title: jobs.title })
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), gte(jobs.discoveredAt, sinceIso)));

	if (newJobs.length === 0) return 0;

	let totalMatches = 0;
	const now = new Date().toISOString();

	for (const entry of entries) {
		const skillLower = entry.skill.toLowerCase();
		const titlePatternLower = entry.titlePattern?.toLowerCase();

		const matchingCount = newJobs.filter((job) => {
			const jobSkills = parseSkills(job.skills);
			if (!jobSkills.some((s) => s.toLowerCase() === skillLower)) return false;
			if (
				titlePatternLower &&
				!job.title.toLowerCase().includes(titlePatternLower)
			)
				return false;
			return true;
		}).length;

		if (matchingCount > 0) {
			await db
				.update(skillWatchlist)
				.set({
					pendingMatchCount: (entry.pendingMatchCount ?? 0) + matchingCount,
					lastMatchAt: now,
				})
				.where(eq(skillWatchlist.id, entry.id));
			totalMatches += matchingCount;
		}
	}

	return totalMatches;
}

function parseSkills(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const trimmed = raw.trim();
		if (trimmed.startsWith("[")) return JSON.parse(trimmed) as string[];
		return trimmed
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}
