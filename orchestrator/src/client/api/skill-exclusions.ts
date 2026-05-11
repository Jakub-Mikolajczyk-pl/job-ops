import { fetchApi } from "./core";

export interface SkillExclusion {
  skill: string;
  excludedAt: string;
  reason: string | null;
}

export async function getSkillExclusions(): Promise<{ exclusions: SkillExclusion[] }> {
  return fetchApi<{ exclusions: SkillExclusion[] }>("/skill-exclusions");
}

export async function addSkillExclusion(skill: string, reason?: string): Promise<void> {
  await fetchApi<unknown>("/skill-exclusions", {
    method: "POST",
    body: JSON.stringify({ skill, reason }),
  });
}

export async function removeSkillExclusion(skill: string): Promise<void> {
  await fetchApi<unknown>(`/skill-exclusions/${encodeURIComponent(skill)}`, { method: "DELETE" });
}
