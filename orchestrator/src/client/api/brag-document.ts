import { fetchApi } from "./core";

export interface BragDocumentStatus {
  hasContent: boolean;
  byteSize: number | null;
  fetchedAt: string | null;
  lastError: string | null;
  sourceUrl: string | null;
  hasToken: boolean;
}

export async function getBragDocument(): Promise<BragDocumentStatus> {
  const data = await fetchApi<{ bragDocument: BragDocumentStatus }>(
    "/brag-document",
  );
  return data.bragDocument;
}

export async function updateBragDocumentSource(input: {
  sourceUrl?: string | null;
  token?: string | null;
}): Promise<BragDocumentStatus> {
  const data = await fetchApi<{ bragDocument: BragDocumentStatus }>(
    "/brag-document/source",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return data.bragDocument;
}

export async function syncBragDocument(): Promise<BragDocumentStatus> {
  const data = await fetchApi<{ bragDocument: BragDocumentStatus }>(
    "/brag-document/sync",
    {
      method: "POST",
    },
  );
  return data.bragDocument;
}
