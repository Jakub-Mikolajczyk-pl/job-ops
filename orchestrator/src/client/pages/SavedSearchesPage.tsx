import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import * as api from "../api/saved-searches";
import { queryKeys } from "../lib/queryKeys";
import type { SavedSearch, SavedSearchQuery } from "../api/saved-searches";
import { PageHeader, PageMain } from "@client/components/layout";

const STATUS_OPTIONS = ["", "discovered", "ready", "applied", "in_progress", "rejected", "skipped"];
const SOURCE_OPTIONS = ["", "gradcracker", "linkedin", "jobspy", "hiringcafe", "justjoinit"];

function queryLabel(q: SavedSearchQuery): string {
  const parts: string[] = [];
  if (q.status) parts.push("status:" + q.status);
  if (q.source) parts.push("source:" + q.source);
  if (q.minScore) parts.push("score>=" + String(q.minScore));
  if (q.keywords) parts.push('"' + q.keywords + '"');
  return parts.length ? parts.join("  ·  ") : "All jobs";
}

function SearchForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<SavedSearch>;
  onSave: (data: { name: string; query: SavedSearchQuery; notifyTelegram: boolean }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState(initial?.query?.status ?? "");
  const [source, setSource] = useState(initial?.query?.source ?? "");
  const [minScore, setMinScore] = useState(String(initial?.query?.minScore ?? ""));
  const [keywords, setKeywords] = useState(initial?.query?.keywords ?? "");
  const [notify, setNotify] = useState(initial?.notifyTelegram ?? false);

  function handleSave() {
    const query: SavedSearchQuery = {};
    if (status) query.status = status;
    if (source) query.source = source;
    if (minScore !== "") query.minScore = Number(minScore);
    if (keywords.trim()) query.keywords = keywords.trim();
    onSave({ name, query, notifyTelegram: notify });
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My search" className="w-full border rounded px-3 py-1.5 text-sm bg-background" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
            {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s || "Any"}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
            {SOURCE_OPTIONS.map((s) => (<option key={s} value={s}>{s || "Any"}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Min Score</label>
          <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0-100" className="w-full border rounded px-3 py-1.5 text-sm bg-background" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Keywords</label>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. React, TypeScript" className="w-full border rounded px-3 py-1.5 text-sm bg-background" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-primary" />
        Notify via Telegram when new matches found
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border rounded hover:bg-muted">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || saving} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function SavedSearchesPage() {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.savedSearches.list(),
    queryFn: api.listSavedSearches,
  });

  const createMut = useMutation({
    mutationFn: api.createSavedSearch,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.savedSearches.all }); setCreating(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...rest }: { id: string; name?: string; query?: SavedSearchQuery; notifyTelegram?: boolean }) =>
      api.updateSavedSearch(id, rest),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.savedSearches.all }); setEditingId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: api.deleteSavedSearch,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.savedSearches.all }),
  });

  const searches = data?.searches ?? [];

  return (
    <>
      <PageHeader
        icon={Bookmark}
        title="Saved Searches"
        subtitle="Save filters to quickly revisit job sets"
        actions={
          !creating ? (
            <button onClick={() => setCreating(true)} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90">
              + New Search
            </button>
          ) : undefined
        }
      />
      <PageMain>
        {creating && (
          <div className="mb-4">
            <SearchForm saving={createMut.isPending} onSave={(d) => createMut.mutate(d)} onCancel={() => setCreating(false)} />
          </div>
        )}

        {isLoading && <div className="py-12 text-center text-muted-foreground">Loading...</div>}

        {!isLoading && searches.length === 0 && !creating && (
          <div className="py-12 text-center text-muted-foreground">No saved searches yet. Create one to quickly filter jobs.</div>
        )}

        <div className="space-y-3 max-w-2xl">
          {searches.map((s) =>
            editingId === s.id ? (
              <SearchForm key={s.id} initial={s} saving={updateMut.isPending} onSave={(d) => updateMut.mutate({ id: s.id, ...d })} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={s.id} className="border rounded-lg p-4 flex items-start justify-between gap-4 hover:bg-muted/20">
                <div className="space-y-1 min-w-0">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{queryLabel(s.query)}</div>
                  {s.notifyTelegram && <div className="text-xs text-green-600 dark:text-green-400">Telegram notifications on</div>}
                  <div className="text-xs text-muted-foreground">Created {new Date(s.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditingId(s.id)} className="text-xs px-2 py-1 border rounded hover:bg-muted">Edit</button>
                  <button onClick={() => deleteMut.mutate(s.id)} disabled={deleteMut.isPending} className="text-xs px-2 py-1 border rounded hover:bg-destructive/10 text-destructive disabled:opacity-50">Delete</button>
                </div>
              </div>
            )
          )}
        </div>
      </PageMain>
    </>
  );
}
