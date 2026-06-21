/**
 * Brag Document repository — tenant-scoped cache of the external achievement
 * bullet bank. One row per tenant (tenantId is the primary key). The read token
 * is stored separately in the settings registry, not here.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { BragDocumentRow } from "../db/schema";
import { getActiveTenantId } from "../tenancy/context";

const { bragDocument } = schema;

function nowIso(): string {
  return new Date().toISOString();
}

export async function getBragDocument(): Promise<BragDocumentRow | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(bragDocument)
    .where(eq(bragDocument.tenantId, tenantId));
  return row ?? null;
}

export async function setSourceUrl(sourceUrl: string | null): Promise<void> {
  const tenantId = getActiveTenantId();
  const updatedAt = nowIso();
  await db
    .insert(bragDocument)
    .values({ tenantId, sourceUrl, updatedAt })
    .onConflictDoUpdate({
      target: bragDocument.tenantId,
      set: { sourceUrl, updatedAt },
    });
}

export async function saveSyncResult(input: {
  content: string;
  byteSize: number;
  sourceUrl: string;
}): Promise<void> {
  const tenantId = getActiveTenantId();
  const fetchedAt = nowIso();
  await db
    .insert(bragDocument)
    .values({
      tenantId,
      sourceUrl: input.sourceUrl,
      content: input.content,
      byteSize: input.byteSize,
      fetchedAt,
      lastError: null,
      updatedAt: fetchedAt,
    })
    .onConflictDoUpdate({
      target: bragDocument.tenantId,
      set: {
        sourceUrl: input.sourceUrl,
        content: input.content,
        byteSize: input.byteSize,
        fetchedAt,
        lastError: null,
        updatedAt: fetchedAt,
      },
    });
}

export async function saveSyncError(message: string): Promise<void> {
  const tenantId = getActiveTenantId();
  const updatedAt = nowIso();
  await db
    .insert(bragDocument)
    .values({ tenantId, lastError: message, updatedAt })
    .onConflictDoUpdate({
      target: bragDocument.tenantId,
      set: { lastError: message, updatedAt },
    });
}
