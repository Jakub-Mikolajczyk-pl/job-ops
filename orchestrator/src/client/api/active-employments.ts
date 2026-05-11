import type {
  ActiveEmployment,
  CreateActiveEmploymentInput,
  UpdateActiveEmploymentInput,
} from "@shared/types.js";
import { fetchApi } from "./core";

export interface SalaryStack {
  monthlyPLN: number;
  annualPLN: number;
  currentCount: number;
}

export async function listActiveEmployments(): Promise<{
  employments: ActiveEmployment[];
  stack: SalaryStack;
}> {
  return fetchApi<{ employments: ActiveEmployment[]; stack: SalaryStack }>(
    "/active-employments",
  );
}

export async function getSalaryStack(): Promise<{ stack: SalaryStack }> {
  return fetchApi<{ stack: SalaryStack }>("/active-employments/salary-stack");
}

export async function createActiveEmployment(
  input: CreateActiveEmploymentInput,
): Promise<{ employment: ActiveEmployment }> {
  return fetchApi<{ employment: ActiveEmployment }>("/active-employments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateActiveEmployment(
  id: string,
  input: UpdateActiveEmploymentInput,
): Promise<{ employment: ActiveEmployment }> {
  return fetchApi<{ employment: ActiveEmployment }>(
    `/active-employments/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteActiveEmployment(id: string): Promise<void> {
  await fetchApi<{ deleted: boolean }>(`/active-employments/${id}`, {
    method: "DELETE",
  });
}
