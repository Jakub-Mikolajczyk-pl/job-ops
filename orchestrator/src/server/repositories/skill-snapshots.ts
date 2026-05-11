import { and, eq, gte, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { skillSnapshots, jobs } = schema;

export interface SkillWeekData {
  week: string;
  count: number;
}

export interface SkillTrend {
  skill: string;
  weeks: SkillWeekData[];
  latestCount: number;
  delta: number;
}

export async function snapshotSkills(): Promise<void> {
  const tenantId = getActiveTenantId();
  const today = new Date().toISOString().slice(0, 10);

  await db.delete(skillSnapshots).where(
    and(eq(skillSnapshots.tenantId, tenantId), eq(skillSnapshots.snapshotDate, today)),
  );

  const rows = await db
    .select({ skills: jobs.skills, suitabilityScore: jobs.suitabilityScore })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId)));

  const counts = new Map<string, { count: number; scoreSum: number }>();
  for (const row of rows) {
    if (!row.skills) continue;
    let parsed: string[] = [];
    try {
      const trimmed = row.skills.trim();
      if (trimmed.startsWith("[")) {
        parsed = JSON.parse(trimmed) as string[];
      } else {
        parsed = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } catch { continue; }
    for (const skill of parsed) {
      const key = skill.trim().toLowerCase();
      if (!key) continue;
      const existing = counts.get(key) ?? { count: 0, scoreSum: 0 };
      existing.count++;
      existing.scoreSum += row.suitabilityScore ?? 0;
      counts.set(key, existing);
    }
  }

  const inserts = [...counts.entries()].map(([skill, { count, scoreSum }]) => ({
    id: randomUUID(),
    tenantId,
    snapshotDate: today,
    skill,
    count,
    avgScore: count > 0 ? scoreSum / count : null,
  }));

  if (inserts.length > 0) {
    for (let i = 0; i < inserts.length; i += 200) {
      await db.insert(skillSnapshots).values(inserts.slice(i, i + 200));
    }
  }

  console.log(`[snapshot-skills] Captured ${inserts.length} skill entries for ${today}`);
}

export async function getSkillTrends(weeks = 8): Promise<SkillTrend[]> {
  const tenantId = getActiveTenantId();
  const cutoff = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(skillSnapshots)
    .where(and(eq(skillSnapshots.tenantId, tenantId), gte(skillSnapshots.snapshotDate, cutoff)))
    .orderBy(desc(skillSnapshots.snapshotDate));

  const bySkill = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const weekKey = row.snapshotDate.slice(0, 10);
    const skillMap = bySkill.get(row.skill) ?? new Map<string, number>();
    skillMap.set(weekKey, (skillMap.get(weekKey) ?? 0) + row.count);
    bySkill.set(row.skill, skillMap);
  }

  const trends: SkillTrend[] = [];
  for (const [skill, weekMap] of bySkill.entries()) {
    const sortedWeeks = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    const weekData: SkillWeekData[] = sortedWeeks.map(([week, count]) => ({ week, count }));
    const latestCount = weekData.at(-1)?.count ?? 0;
    const prevCount = weekData.at(-2)?.count ?? 0;
    const delta = latestCount - prevCount;
    trends.push({ skill, weeks: weekData, latestCount, delta });
  }

  return trends
    .filter((t) => t.latestCount >= 2)
    .sort((a, b) => b.latestCount - a.latestCount)
    .slice(0, 30);
}
