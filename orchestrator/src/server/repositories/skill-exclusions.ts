import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { skillExclusions } = schema;

export interface SkillExclusion {
  skill: string;
  excludedAt: string;
  reason: string | null;
}

export async function getSkillExclusions(): Promise<SkillExclusion[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(skillExclusions)
    .where(eq(skillExclusions.tenantId, tenantId));
  return rows.map((r) => ({ skill: r.skill, excludedAt: r.excludedAt, reason: r.reason ?? null }));
}

export async function addSkillExclusion(skill: string, reason?: string): Promise<void> {
  const tenantId = getActiveTenantId();
  const skillLower = skill.toLowerCase().trim();
  // Delete first to handle the composite unique constraint cleanly
  await db
    .delete(skillExclusions)
    .where(and(eq(skillExclusions.tenantId, tenantId), eq(skillExclusions.skill, skillLower)));
  await db.insert(skillExclusions).values({ tenantId, skill: skillLower, reason: reason ?? null });
}

export async function removeSkillExclusion(skill: string): Promise<void> {
  const tenantId = getActiveTenantId();
  const skillLower = skill.toLowerCase().trim();
  await db
    .delete(skillExclusions)
    .where(and(eq(skillExclusions.tenantId, tenantId), eq(skillExclusions.skill, skillLower)));
}
