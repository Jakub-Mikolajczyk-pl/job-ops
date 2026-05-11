import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { profileMarketSnapshots, jobs } = schema;

export interface MarketSnapshotPoint {
	week: string;
	totalJobs: number;
	jobsAbove60: number;
	jobsAbove75: number;
	avgScore: number | null;
}

export interface MarketTrendResult {
	weeks: MarketSnapshotPoint[];
	alert: "drop" | "rise" | null;
	alertPct: number | null;
}

export async function snapshotMarket(): Promise<void> {
	const tenantId = getActiveTenantId();
	const today = new Date().toISOString().slice(0, 10);

	const rows = await db
		.select({ suitabilityScore: jobs.suitabilityScore })
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId));

	let totalJobs = 0;
	let jobsAbove60 = 0;
	let jobsAbove75 = 0;
	let scoreSum = 0;
	let scoredCount = 0;

	for (const row of rows) {
		totalJobs++;
		const score = row.suitabilityScore;
		if (score != null) {
			scoredCount++;
			scoreSum += score;
			if (score >= 60) jobsAbove60++;
			if (score >= 75) jobsAbove75++;
		}
	}

	const avgScore = scoredCount > 0 ? scoreSum / scoredCount : null;

	await db
		.delete(profileMarketSnapshots)
		.where(
			and(
				eq(profileMarketSnapshots.tenantId, tenantId),
				eq(profileMarketSnapshots.snapshotDate, today),
			),
		);

	await db.insert(profileMarketSnapshots).values({
		tenantId,
		snapshotDate: today,
		totalJobs,
		jobsAbove60,
		jobsAbove75,
		avgScore,
		capturedAt: new Date().toISOString(),
	});

	console.log(
		`[snapshot-market] ${today}: totalJobs=${totalJobs} above60=${jobsAbove60} above75=${jobsAbove75}`,
	);
}

export async function getMarketTrend(weeks = 8): Promise<MarketTrendResult> {
	const tenantId = getActiveTenantId();
	const cutoff = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);

	const rows = await db
		.select()
		.from(profileMarketSnapshots)
		.where(
			and(
				eq(profileMarketSnapshots.tenantId, tenantId),
				gte(profileMarketSnapshots.snapshotDate, cutoff),
			),
		)
		.orderBy(profileMarketSnapshots.snapshotDate);

	// Group by ISO week (Monday-anchored)
	const byWeek = new Map<
		string,
		{
			totalJobs: number;
			jobsAbove60: number;
			jobsAbove75: number;
			scoreSum: number;
			count: number;
		}
	>();

	for (const row of rows) {
		const weekKey = toIsoWeek(row.snapshotDate);
		const existing = byWeek.get(weekKey) ?? {
			totalJobs: 0,
			jobsAbove60: 0,
			jobsAbove75: 0,
			scoreSum: 0,
			count: 0,
		};
		// Take the latest snapshot in each week (overwrite with later date's data)
		byWeek.set(weekKey, {
			totalJobs: row.totalJobs,
			jobsAbove60: row.jobsAbove60,
			jobsAbove75: row.jobsAbove75,
			scoreSum: existing.scoreSum + (row.avgScore ?? 0),
			count: existing.count + 1,
		});
	}

	const weekPoints: MarketSnapshotPoint[] = [...byWeek.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([week, v]) => ({
			week,
			totalJobs: v.totalJobs,
			jobsAbove60: v.jobsAbove60,
			jobsAbove75: v.jobsAbove75,
			avgScore: v.count > 0 ? v.scoreSum / v.count : null,
		}));

	// Compute rolling alert: compare last 4 weeks vs prior 4 weeks on jobsAbove60
	let alert: "drop" | "rise" | null = null;
	let alertPct: number | null = null;

	if (weekPoints.length >= 4) {
		const half = Math.floor(weekPoints.length / 2);
		const prior = weekPoints.slice(0, half);
		const recent = weekPoints.slice(-half);
		const priorAvg =
			prior.reduce((s, p) => s + p.jobsAbove60, 0) / prior.length;
		const recentAvg =
			recent.reduce((s, p) => s + p.jobsAbove60, 0) / recent.length;

		if (priorAvg > 0) {
			const pct = ((recentAvg - priorAvg) / priorAvg) * 100;
			if (pct <= -30) {
				alert = "drop";
				alertPct = Math.round(Math.abs(pct));
			} else if (pct >= 30) {
				alert = "rise";
				alertPct = Math.round(pct);
			}
		}
	}

	return { weeks: weekPoints, alert, alertPct };
}

function toIsoWeek(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	// Find Monday of this week
	const day = d.getUTCDay(); // 0=Sun
	const diff = day === 0 ? -6 : 1 - day;
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() + diff);
	return monday.toISOString().slice(0, 10);
}
