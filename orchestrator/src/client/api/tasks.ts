import type { YourMove } from "@shared/types";
import { fetchApi } from "./core";

/** "Your move" action board (RECRUITMENT_TASKS.md R3). */
export async function getYourMove(): Promise<YourMove> {
  return fetchApi<YourMove>("/tasks/your-move");
}

export async function completeTask(
  taskId: string,
): Promise<{ id: string; isCompleted: boolean }> {
  return fetchApi(`/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
  });
}

export async function snoozeTask(
  taskId: string,
  days: number,
): Promise<{ id: string; dueDate: number }> {
  return fetchApi(`/tasks/${encodeURIComponent(taskId)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ days }),
  });
}
