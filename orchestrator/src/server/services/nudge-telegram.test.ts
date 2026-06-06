import type { YourMove, YourMoveTask } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { formatNudge, sendDailyNudge } from "./nudge-telegram";

function task(over: Partial<YourMoveTask>): YourMoveTask {
  return {
    id: "t1",
    applicationId: "j1",
    type: "follow_up",
    title: "Reply to recruiter",
    dueDate: Math.floor(Date.parse("2026-06-05") / 1000),
    notes: null,
    company: "Acme Corp",
    position: "Senior Java Dev",
    jobUrl: "recruitment://acme-senior-java-dev",
    ...over,
  };
}

const empty: YourMove = { overdue: [], today: [], soon: [], needsReview: [] };

describe("formatNudge", () => {
  it("returns null when nothing is overdue or due today", () => {
    expect(formatNudge({ ...empty, soon: [task({})] })).toBeNull();
  });

  it("lists overdue and today tasks with company/position", () => {
    const msg = formatNudge({
      ...empty,
      overdue: [task({ title: "Send CV" })],
      today: [task({ id: "t2", title: "Book call" })],
    });
    expect(msg).toContain("Overdue (1)");
    expect(msg).toContain("Due today (1)");
    expect(msg).toContain("Acme Corp");
    expect(msg).toContain("Send CV");
    // Real unicode, not escape sequences.
    expect(msg).toContain("🔴");
  });
});

describe("sendDailyNudge", () => {
  it("does not send when buckets are empty", async () => {
    const fetchFn = vi.fn();
    const result = await sendDailyNudge({
      fetchFn: fetchFn as unknown as typeof fetch,
      botToken: "token",
      chatId: "chat",
      getYourMove: async () => empty,
    });
    expect(result.sent).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends exactly one message when there are overdue tasks", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "" });
    const result = await sendDailyNudge({
      fetchFn: fetchFn as unknown as typeof fetch,
      botToken: "token",
      chatId: "chat",
      getYourMove: async () => ({ ...empty, overdue: [task({})] }),
    });
    expect(result.sent).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("/bottoken/sendMessage");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.chat_id).toBe("chat");
    expect(payload.text).toContain("Acme Corp");
  });

  it("no-ops without bot configuration", async () => {
    const fetchFn = vi.fn();
    const result = await sendDailyNudge({
      fetchFn: fetchFn as unknown as typeof fetch,
      botToken: undefined,
      chatId: undefined,
      getYourMove: async () => ({ ...empty, overdue: [task({})] }),
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("telegram not configured");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
