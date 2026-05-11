import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/jobs";
import { queryKeys } from "../lib/queryKeys";

const SKIP_REASONS = [
  "overqualified",
  "underqualified",
  "bad location",
  "salary too low",
  "poor culture fit",
  "role mismatch",
  "company concerns",
  "other",
] as const;

interface SkipReasonModalProps {
  jobId: string;
  jobTitle: string;
  onClose: () => void;
}

export function SkipReasonModal({ jobId, jobTitle, onClose }: SkipReasonModalProps) {
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.skipJobWithReason(jobId, selected === "other" ? custom : selected),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background border rounded-lg p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-1">Skip Job</h2>
        <p className="text-sm text-muted-foreground mb-4 truncate">{jobTitle}</p>

        <div className="space-y-2 mb-4">
          {SKIP_REASONS.map((reason) => (
            <label key={reason} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="skip-reason"
                value={reason}
                checked={selected === reason}
                onChange={() => setSelected(reason)}
                className="accent-primary"
              />
              <span className="capitalize text-sm">{reason}</span>
            </label>
          ))}
        </div>

        {selected === "other" && (
          <input
            type="text"
            placeholder="Enter reason..."
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="w-full border rounded px-3 py-1.5 text-sm mb-4 bg-background"
            autoFocus
          />
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!selected || (selected === "other" && !custom.trim()) || mutation.isPending}
            className="px-4 py-2 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {mutation.isPending ? "Skipping..." : "Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}
