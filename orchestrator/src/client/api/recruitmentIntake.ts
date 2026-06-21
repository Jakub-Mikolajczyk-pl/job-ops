import type {
  RecruitmentIntakeDashboard,
  RecruitmentIntakeKind,
  RecruitmentIntakeSource,
  RecruitmentIntakeStatus,
} from "@shared/types";
import { fetchApi } from "./core";

export async function fetchRecruitmentIntakeDashboard(): Promise<RecruitmentIntakeDashboard> {
  return fetchApi<RecruitmentIntakeDashboard>("/ingest/dashboard");
}

export interface RecruitmentIntakeRow {
  id: string;
  source: RecruitmentIntakeSource;
  kind: RecruitmentIntakeKind;
  status: RecruitmentIntakeStatus;
  rawText: string;
  error: string | null;
  jobId: string | null;
  createdAt: string;
}

/** Fetch one intake row in full (raw text) for editing. */
export async function fetchRecruitmentIntakeRow(
  id: string,
): Promise<RecruitmentIntakeRow> {
  return fetchApi<RecruitmentIntakeRow>(`/ingest/${id}`);
}

/** Re-run extraction on a row; `force` also re-runs an already-processed row. */
export async function reprocessRecruitmentIntake(
  id: string,
  force = false,
): Promise<unknown> {
  return fetchApi(`/ingest/${id}/process`, {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

/** Save edited raw text and re-arm the row for extraction. */
export async function updateRecruitmentIntakeText(
  id: string,
  rawText: string,
): Promise<unknown> {
  return fetchApi(`/ingest/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ rawText }),
  });
}

/** Delete an intake row. */
export async function deleteRecruitmentIntake(id: string): Promise<unknown> {
  return fetchApi(`/ingest/${id}`, { method: "DELETE" });
}
