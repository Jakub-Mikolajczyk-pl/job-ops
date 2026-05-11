import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";
import { randomUUID } from "crypto";

const { savedSearches } = schema;

export interface SavedSearchQuery {
  status?: string;
  source?: string;
  minScore?: number;
  keywords?: string;
}

export interface SavedSearch {
  id: string;
  tenantId: string;
  name: string;
  query: SavedSearchQuery;
  notifyTelegram: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToSavedSearch(row: typeof savedSearches.$inferSelect): SavedSearch {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    query: JSON.parse(row.query) as SavedSearchQuery,
    notifyTelegram: Boolean(row.notifyTelegram),
    lastNotifiedAt: row.lastNotifiedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.tenantId, tenantId))
    .orderBy(desc(savedSearches.createdAt));
  return rows.map(rowToSavedSearch);
}

export async function getSavedSearch(id: string): Promise<SavedSearch | null> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? rowToSavedSearch(rows[0]) : null;
}

export async function createSavedSearch(input: {
  name: string;
  query: SavedSearchQuery;
  notifyTelegram?: boolean;
}): Promise<SavedSearch> {
  const tenantId = getActiveTenantId();
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(savedSearches).values({
    id,
    tenantId,
    name: input.name,
    query: JSON.stringify(input.query),
    notifyTelegram: input.notifyTelegram ?? false,
    createdAt: now,
    updatedAt: now,
  });
  return (await getSavedSearch(id))!;
}

export async function updateSavedSearch(
  id: string,
  input: { name?: string; query?: SavedSearchQuery; notifyTelegram?: boolean },
): Promise<SavedSearch | null> {
  const tenantId = getActiveTenantId();
  const now = new Date().toISOString();
  await db
    .update(savedSearches)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.query !== undefined ? { query: JSON.stringify(input.query) } : {}),
      ...(input.notifyTelegram !== undefined ? { notifyTelegram: input.notifyTelegram } : {}),
      updatedAt: now,
    })
    .where(and(eq(savedSearches.id, id), eq(savedSearches.tenantId, tenantId)));
  return getSavedSearch(id);
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.tenantId, tenantId)));
}
