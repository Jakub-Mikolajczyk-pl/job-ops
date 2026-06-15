import type { RecruitmentIntakeDashboard } from "@shared/types";
import { fetchApi } from "./core";

export async function fetchRecruitmentIntakeDashboard(): Promise<RecruitmentIntakeDashboard> {
  return fetchApi<RecruitmentIntakeDashboard>("/ingest/dashboard");
}
