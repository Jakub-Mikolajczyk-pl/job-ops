import type { BragDocumentStatus } from "@client/api";
import * as api from "@client/api";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type BragDocumentSectionProps = {
  layoutMode?: "accordion" | "panel";
};

function BragDocumentStatusView({
  status,
  isLoading,
}: {
  status: BragDocumentStatus | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading status…</p>;
  }
  if (!status) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Cached</dt>
      <dd>
        {status.hasContent ? `${status.byteSize ?? 0} bytes` : "No content yet"}
      </dd>
      <dt className="text-muted-foreground">Last synced</dt>
      <dd>
        {status.fetchedAt
          ? new Date(status.fetchedAt).toLocaleString()
          : "Never"}
      </dd>
      <dt className="text-muted-foreground">Token</dt>
      <dd>{status.hasToken ? "Set" : "Not set"}</dd>
      {status.lastError ? (
        <>
          <dt className="text-destructive">Last error</dt>
          <dd className="text-destructive">{status.lastError}</dd>
        </>
      ) : null}
    </dl>
  );
}

export const BragDocumentSection: React.FC<BragDocumentSectionProps> = ({
  layoutMode,
}) => {
  const [status, setStatus] = useState<BragDocumentStatus | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api.getBragDocument();
        if (!active) return;
        setStatus(result);
        setSourceUrl(result.sourceUrl ?? "");
      } catch (error) {
        showErrorToast(error, "Failed to load brag document settings");
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSaveSource = async () => {
    setIsSaving(true);
    try {
      const trimmedUrl = sourceUrl.trim();
      const trimmedToken = token.trim();
      const next = await api.updateBragDocumentSource({
        sourceUrl: trimmedUrl ? trimmedUrl : null,
        ...(trimmedToken ? { token: trimmedToken } : {}),
      });
      setStatus(next);
      setToken("");
      toast.success("Brag document source saved.");
    } catch (error) {
      showErrorToast(error, "Failed to save brag document source");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const next = await api.syncBragDocument();
      setStatus(next);
      if (next.lastError) {
        toast.error(`Sync failed: ${next.lastError}`);
      } else {
        toast.success("Brag document synced.");
      }
    } catch (error) {
      showErrorToast(error, "Failed to sync brag document");
    } finally {
      setIsSyncing(false);
    }
  };

  const busy = isLoading || isSaving || isSyncing;

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Brag Document"
      value="brag-document"
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Pull a curated achievement bullet bank from brain-memory (Forgejo) and
          feed it into CV tailoring, Ghostwriter, and the Resume Studio
          assistant. Supplementary input only — not your base resume, and not a
          per-job document.
        </p>

        <div className="space-y-2">
          <Label htmlFor="brag-doc-source-url">
            Source URL (Forgejo raw file)
          </Label>
          <Input
            id="brag-doc-source-url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="http://…/jakub/brain-memory/raw/branch/master/STATE/brag-document.md"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="brag-doc-token">Read token</Label>
          <Input
            id="brag-doc-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              status?.hasToken
                ? "•••••• (set — leave blank to keep)"
                : "Forgejo read token"
            }
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Stored as a secret (or the BRAG_DOC_SOURCE_TOKEN env). Sent as an
            "Authorization: token …" header.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSaveSource} disabled={busy}>
            {isSaving ? "Saving…" : "Save source"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSyncNow}
            disabled={busy || !status?.sourceUrl}
          >
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>

        <Separator />

        <BragDocumentStatusView status={status} isLoading={isLoading} />
      </div>
    </SettingsSectionFrame>
  );
};
