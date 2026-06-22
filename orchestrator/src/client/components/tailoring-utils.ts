import type { ResumeProfile } from "@shared/types";

export interface TailoredSkillGroup {
  name: string;
  keywords: string[];
}

export interface EditableSkillGroup {
  id: string;
  name: string;
  keywordsText: string;
}

let skillDraftCounter = 0;

export function createTailoredSkillDraftId(): string {
  skillDraftCounter += 1;
  return `skill-group-${skillDraftCounter}`;
}

export function parseTailoredSkills(
  raw: string | null | undefined,
): TailoredSkillGroup[] {
  if (!raw || raw.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const groups: TailoredSkillGroup[] = [];
    const legacyKeywords: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        const keyword = item.trim();
        if (keyword.length > 0) legacyKeywords.push(keyword);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const keywordsRaw = Array.isArray(record.keywords)
        ? record.keywords
        : typeof record.keywords === "string"
          ? record.keywords.split(",")
          : [];
      const keywords = keywordsRaw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);

      if (!name && keywords.length === 0) continue;
      groups.push({ name, keywords });
    }

    if (legacyKeywords.length > 0) {
      groups.push({ name: "Skills", keywords: legacyKeywords });
    }

    return groups;
  } catch {
    return [];
  }
}

export function serializeTailoredSkills(groups: TailoredSkillGroup[]): string {
  if (groups.length === 0) return "";
  return JSON.stringify(groups);
}

export function toEditableSkillGroups(
  groups: TailoredSkillGroup[],
): EditableSkillGroup[] {
  return groups.map((group) => ({
    id: createTailoredSkillDraftId(),
    name: group.name,
    keywordsText: group.keywords.join(", "),
  }));
}

export function fromEditableSkillGroups(
  groups: EditableSkillGroup[],
): TailoredSkillGroup[] {
  const normalized: TailoredSkillGroup[] = [];

  for (const group of groups) {
    const name = group.name.trim();
    const keywords = group.keywordsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!name && keywords.length === 0) continue;
    normalized.push({ name, keywords });
  }

  return normalized;
}

export function getOriginalSummary(profile: ResumeProfile | null): string {
  if (!profile) return "";
  return profile.basics?.summary?.trim() ?? "";
}

export function getOriginalHeadline(profile: ResumeProfile | null): string {
  if (!profile) return "";
  return profile.basics?.label?.trim() ?? "";
}

export function getOriginalSkills(
  profile: ResumeProfile | null,
): TailoredSkillGroup[] {
  if (!profile) return [];

  const items = profile.sections?.skills?.items;
  if (!Array.isArray(items)) return [];

  const groups: TailoredSkillGroup[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const name =
      typeof item.name === "string"
        ? item.name.trim()
        : typeof item.description === "string"
          ? item.description.trim()
          : "";
    const keywordsRaw = Array.isArray(item.keywords) ? item.keywords : [];
    const keywords = keywordsRaw
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) => value.trim())
      .filter(Boolean);
    if (!name && keywords.length === 0) continue;
    groups.push({ name, keywords });
  }

  return groups;
}

export interface SkillGroupChange {
  /** Lowercased keywords the AI added vs the base resume (for highlighting). */
  added: Set<string>;
  /** Original-case keywords present in the base but dropped from the draft. */
  removed: string[];
}

/**
 * Diff the current tailored skill groups against the base resume skills, matched
 * by category name (case-insensitive). Returns a per-draft-group change keyed by
 * the draft group's id; groups with no changes are omitted.
 */
export function computeSkillChanges(
  baseGroups: TailoredSkillGroup[],
  draftGroups: EditableSkillGroup[],
): Map<string, SkillGroupChange> {
  const baseByCategory = new Map<string, string[]>();
  for (const group of baseGroups) {
    const key = group.name.trim().toLowerCase();
    const existing = baseByCategory.get(key) ?? [];
    existing.push(...group.keywords);
    baseByCategory.set(key, existing);
  }

  const changes = new Map<string, SkillGroupChange>();
  for (const draft of draftGroups) {
    const draftKeywords = draft.keywordsText
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const draftLower = new Set(
      draftKeywords.map((value) => value.toLowerCase()),
    );

    const baseKeywords =
      baseByCategory.get(draft.name.trim().toLowerCase()) ?? [];
    const baseLower = new Set(baseKeywords.map((value) => value.toLowerCase()));

    const added = new Set<string>();
    for (const keyword of draftKeywords) {
      if (!baseLower.has(keyword.toLowerCase())) {
        added.add(keyword.toLowerCase());
      }
    }

    const removed: string[] = [];
    const seenRemoved = new Set<string>();
    for (const keyword of baseKeywords) {
      const lower = keyword.toLowerCase();
      if (!draftLower.has(lower) && !seenRemoved.has(lower)) {
        seenRemoved.add(lower);
        removed.push(keyword);
      }
    }

    if (added.size > 0 || removed.length > 0) {
      changes.set(draft.id, { added, removed });
    }
  }

  return changes;
}
