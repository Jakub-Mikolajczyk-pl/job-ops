/**
 * Daily Telegram nudge (RECRUITMENT_TASKS.md R3).
 *
 * Reads the "Your move" board and pushes overdue + due-today action points to
 * the JobOps Inbox chat once a day via the Telegram Bot API. The ADHD safety
 * net: if an action point never gets looked at on the web page, it still
 * arrives as a message.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. `fetch`, the clock, and the data
 * source are injectable so the formatter + sender are unit-testable offline.
 */

import { logger } from "@infra/logger";
import type { YourMove, YourMoveTask } from "@shared/types";
import { getYourMove as defaultGetYourMove } from "../repositories/tasks";
import { createScheduler } from "../utils/scheduler";

export interface NudgeDeps {
  fetchFn?: typeof fetch;
  now?: Date;
  getYourMove?: (now: Date) => Promise<YourMove>;
  botToken?: string;
  chatId?: string;
}

export interface NudgeResult {
  sent: boolean;
  reason?: string;
  message?: string;
}

function formatTask(task: YourMoveTask): string {
  const due =
    task.dueDate != null
      ? new Date(task.dueDate * 1000).toISOString().slice(0, 10)
      : "no date";
  return `• ${task.company} — ${task.position}: ${task.title} (${due})`;
}

/**
 * Build the nudge message from overdue + today buckets. Returns null when both
 * are empty (nothing actionable → no message, no send).
 */
export function formatNudge(move: YourMove): string | null {
  const { overdue, today } = move;
  if (overdue.length === 0 && today.length === 0) return null;

  const lines: string[] = ["🎯 Your move today"];
  if (overdue.length > 0) {
    lines.push("", `🔴 Overdue (${overdue.length})`);
    for (const task of overdue) lines.push(formatTask(task));
  }
  if (today.length > 0) {
    lines.push("", `📅 Due today (${today.length})`);
    for (const task of today) lines.push(formatTask(task));
  }
  if (move.needsReview.length > 0) {
    lines.push("", `❓ ${move.needsReview.length} intake(s) need review`);
  }
  return lines.join("\n");
}

/**
 * Compose + send today's nudge. No-ops (sent:false) when the bot is not
 * configured or there is nothing to say. Never throws — a failed send is
 * logged and reported, so the scheduler stays healthy.
 */
export async function sendDailyNudge(
  deps: NudgeDeps = {},
): Promise<NudgeResult> {
  const now = deps.now ?? new Date();
  const fetchFn = deps.fetchFn ?? fetch;
  const botToken = deps.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = deps.chatId ?? process.env.TELEGRAM_CHAT_ID;
  const getYourMove = deps.getYourMove ?? defaultGetYourMove;

  if (!botToken || !chatId) {
    return { sent: false, reason: "telegram not configured" };
  }

  const move = await getYourMove(now);
  const message = formatNudge(move);
  if (!message) {
    return { sent: false, reason: "nothing to nudge" };
  }

  try {
    const response = await fetchFn(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("Telegram nudge send failed", {
        status: response.status,
        body: body.slice(0, 300),
      });
      return { sent: false, reason: `telegram ${response.status}`, message };
    }
    logger.info("Telegram nudge sent", {
      overdue: move.overdue.length,
      today: move.today.length,
    });
    return { sent: true, message };
  } catch (error) {
    logger.warn("Telegram nudge threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "send error", message };
  }
}

/**
 * Hour (UTC, 0–23) the daily nudge fires. Defaults to 6 UTC ≈ 08:00
 * Europe/Warsaw in summer (CEST). Override with NUDGE_HOUR_UTC.
 */
function parseNudgeHourUtc(): number {
  const raw = Number.parseInt(process.env.NUDGE_HOUR_UTC ?? "", 10);
  if (Number.isNaN(raw)) return 6;
  return Math.min(23, Math.max(0, raw));
}

let nudgeScheduler: ReturnType<typeof createScheduler> | null = null;

/**
 * Register the once-a-day nudge at server start. Reuses the shared daily
 * scheduler (same util as backups/visa-sponsors). No-op when Telegram is not
 * configured — capture/extraction still work without it.
 */
export function startNudgeScheduler(): void {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    logger.info(
      "Recruitment nudge disabled (TELEGRAM_BOT_TOKEN/CHAT_ID unset)",
    );
    return;
  }
  if (nudgeScheduler) return;
  nudgeScheduler = createScheduler("recruitment-nudge", async () => {
    await sendDailyNudge();
  });
  nudgeScheduler.start(parseNudgeHourUtc());
}

/** Stop the nudge scheduler (test/teardown seam). */
export function stopNudgeScheduler(): void {
  nudgeScheduler?.stop();
  nudgeScheduler = null;
}
