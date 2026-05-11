import { logger } from "@infra/logger";
import type { Job } from "@shared/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

interface InterviewQuestion {
  q: string;
  hint: string;
}

interface InterviewPrepResult {
  success: boolean;
  markdown?: string;
  error?: string;
}

const SCHEMA = {
  name: "interview_prep",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            hint: { type: "string" },
          },
          required: ["q", "hint"],
        },
      },
    },
    required: ["questions"],
  },
};

export async function generateInterviewPrep(job: Job): Promise<InterviewPrepResult> {
  const model = await resolveLlmModel();
  const llm = await createConfiguredLlmService();

  const skillsText = job.skills ? `Skills required: ${job.skills}` : "";
  const summaryText = job.tailoredSummary ? `Your tailored summary: ${job.tailoredSummary}` : "";
  const descSnippet = job.jobDescription ? job.jobDescription.slice(0, 1500) : "No description available.";

  const prompt = `You are an interview coach. Generate 8-10 likely interview questions for this role.

Role: ${job.title} at ${job.employer}
${skillsText}
${summaryText}
Job description excerpt:
${descSnippet}

For each question, provide a short hint (1-2 sentences) on what a strong answer covers. Return JSON matching the schema.`;

  const result = await llm.callJson<{ questions: InterviewQuestion[] }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: SCHEMA,
  });

  if (!result.success) {
    logger.warn("Interview prep LLM call failed", { error: result.error, jobId: job.id });
    return { success: false, error: result.error };
  }

  const questions = result.data?.questions ?? [];
  if (questions.length === 0) {
    return { success: false, error: "LLM returned no questions" };
  }

  const markdown =
    "## Interview Prep\n\n" +
    questions
      .map((q, i) => `### ${i + 1}. ${q.q}\n\n*${q.hint}*`)
      .join("\n\n");

  return { success: true, markdown };
}
