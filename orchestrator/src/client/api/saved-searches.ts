import { fetchApi } from "./core";

export interface SavedSearchQuery {
  status?: string;
  source?: string;
  minScore?: number;
  keywords?: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: SavedSearchQuery;
  notifyTelegram: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listSavedSearches(): Promise<{ searches: SavedSearch[] }> {
  return fetchApi<{ searches: SavedSearch[] }>("/saved-searches");
}

export async function createSavedSearch(input: {
  name: string;
  query: SavedSearchQuery;
  notifyTelegram?: boolean;
}): Promise<SavedSearch> {
  return fetchApi<SavedSearch>("/saved-searches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSavedSearch(
  id: string,
  input: { name?: string; query?: SavedSearchQuery; notifyTelegram?: boolean },
): Promise<SavedSearch> {
  return fetchApi<SavedSearch>(`/saved-searches/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await fetchApi<unknown>(`/saved-searches/${id}`, { method: "DELETE" });
}
