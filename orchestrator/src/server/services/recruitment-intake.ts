/**
 * Recruitment intake worker (RECRUITMENT_TASKS.md R2).
 * Consumes a raw_intake row, extracts structured fields via the configured
 * LLM, classifies NEW vs UPDATE by a synthetic stable jobUrl, and upserts a
 * job + stage event + tasks (action points) + notes (+ interview study-topics
 * for tech-call transcripts). Idempotent: a processed row is never re-applied.
 *
 * Reuses the app's own LLM provider via ./modelSelection (same path as
 * interview-prep / ghostwriter) — no separate AI client.
 */

import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import {
  APPLICATION_STAGES,
  type ApplicationStage,
  STUDY_TOPIC_PRIORITIES,
  type StudyTopicPriority,
} from "@shared/types";
import { db, schema } from "../db/index";
import {
  createJob,
  createJobNote,
  getJobByUrl,
  updateJob,
} from "../repositories/jobs";
import * as intakeRepo from "../repositories/recruitmentIntake";
import { getActiveTenantId } from "../tenancy/context";
import { transitionStage } from "./applicationTracking";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { scoreRecruitment } from "./recruitment-profile";

export type IntakeAction =
  | "created"
  | "updated"
  | "needs_review"
  | "skipped_non_recruitment"
  | "skipped"
  | "error";

export interface IntakeResult {
  intakeId: string;
  action: IntakeAction;
  jobId?: string;
  reason?: string;
}

interface Extraction {
  isRecruitment: boolean;
  company: string;
  position: string;
  stage: string;
  contractType?: string;
  rate?: string;
  salaryRange?: string;
  workModel?: string;
  location?: string;
  techStack?: string[];
  recruiterName?: string;
  agency?: string;
  jobPostUrl?: string;
  priority?: string;
  nextAction?: string;
  nextActionDue?: string;
  flags?: string;
  companyNotes?: string;
  notes?: string;
  isTechInterview?: boolean;
  studyTopics?: string[];
  hesitations?: string[];
  concepts?: string[];
}

const EXTRACTION_SCHEMA = {
  name: "recruitment_extraction",
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      isRecruitment: { type: "boolean" },
      company: { type: "string" },
      position: { type: "string" },
      stage: { type: "string", enum: [...APPLICATION_STAGES] },
      contractType: { type: "string" },
      rate: { type: "string" },
      salaryRange: { type: "string" },
      workModel: { type: "string" },
      location: { type: "string" },
      techStack: { type: "array", items: { type: "string" } },
      recruiterName: { type: "string" },
      agency: { type: "string" },
      jobPostUrl: { type: "string" },
      priority: { type: "string", enum: [...STUDY_TOPIC_PRIORITIES] },
      nextAction: { type: "string" },
      nextActionDue: { type: "string" },
      flags: { type: "string" },
      companyNotes: { type: "string" },
      notes: { type: "string" },
      isTechInterview: { type: "boolean" },
      studyTopics: { type: "array", items: { type: "string" } },
      hesitations: { type: "array", items: { type: "string" } },
      concepts: { type: "array", items: { type: "string" } },
    },
    required: ["isRecruitment", "company", "position", "stage"],
  },
  additionalProperties: false,
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function clean(value?: string | null): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function toEpochSeconds(iso?: string): number | undefined {
  const v = clean(iso);
  if (!v) return undefined;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

function normalizeStage(stage?: string): ApplicationStage {
  return (APPLICATION_STAGES as readonly string[]).includes(stage ?? "")
    ? (stage as ApplicationStage)
    : "applied";
}

function buildPrompt(kind: string, rawText: string): string {
  return `You are Jakub's recruitment intake analyst. Extract structured data from the raw material below (a ${kind}). Polish or English input.

RULES:
- Do NOT invent. If a field is not present, return an empty string (or empty array). Never guess a company, rate, or name.
- "stage" MUST be one of the enum values. If unclear, use "applied".
- "isRecruitment": false if this is clearly NOT about a job opportunity (e.g. a private call, a video, unrelated chatter).
- If this is a technical/HR interview transcript, set "isTechInterview": true and fill studyTopics (concepts to study), hesitations (where the candidate struggled), concepts (technical terms mentioned).
- "nextAction": one concrete next step for Jakub. "nextActionDue": ISO date if a deadline is implied.
- "flags": red/green flags, format "🟢 ... | 🔴 ...". "companyNotes": 2-3 sentence summary of the company.

RAW MATERIAL:
${rawText.slice(0, 40000)}`;
}

async function extract(kind: string, rawText: string): Promise<Extraction> {
  const model = await resolveLlmModel();
  const llm = await createConfiguredLlmService();
  const result = await llm.callJson<Extraction>({
    model,
    messages: [{ role: "user", content: buildPrompt(kind, rawText) }],
    jsonSchema: EXTRACTION_SCHEMA,
  });
  if (!result.success) {
    throw new Error(result.error ?? "LLM extraction failed");
  }
  if (!result.data) {
    throw new Error("LLM extraction returned no data");
  }
  return result.data;
}

function noteBody(ex: Extraction, kind: string): string {
  const lines = [
    `Source: ${kind}`,
    ex.recruiterName ? `Contact: ${ex.recruiterName}` : null,
    ex.agency ? `Agency: ${ex.agency}` : null,
    ex.contractType ? `Contract: ${ex.contractType}` : null,
    ex.rate ? `Rate: ${ex.rate}` : null,
    ex.salaryRange ? `Range: ${ex.salaryRange}` : null,
    ex.workModel ? `Work model: ${ex.workModel}` : null,
    ex.flags ? `Flags: ${ex.flags}` : null,
    ex.companyNotes ? `\n${ex.companyNotes}` : null,
    ex.notes ? `\n${ex.notes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function isRemote(workModel?: string): boolean | undefined {
  const v = clean(workModel)?.toLowerCase();
  if (!v) return undefined;
  if (v.includes("remote") || v.includes("zdaln")) return true;
  return false;
}

async function createTask(
  jobId: string,
  title: string,
  dueDate?: number,
  notes?: string,
): Promise<void> {
  await db.insert(schema.tasks).values({
    id: randomUUID(),
    tenantId: getActiveTenantId(),
    applicationId: jobId,
    type: "follow_up",
    title: title.slice(0, 300),
    dueDate: dueDate ?? null,
    isCompleted: false,
    notes: notes ?? null,
  });
}

async function recordStudyTopics(
  jobId: string,
  ex: Extraction,
  priority: string,
): Promise<void> {
  await db.insert(schema.interviewStudyTopics).values({
    id: randomUUID(),
    tenantId: getActiveTenantId(),
    applicationId: jobId,
    interviewId: null,
    company: clean(ex.company) ?? null,
    role: clean(ex.position) ?? null,
    topicsJson: ex.studyTopics ?? [],
    hesitationsJson: ex.hesitations ?? [],
    conceptsJson: ex.concepts ?? [],
    priority: (priority as StudyTopicPriority) ?? "medium",
    exportedToRekru: false,
  });
}

function channelSource(kind: string): string {
  if (kind === "linkedin_msg") return "linkedin";
  if (kind === "recruiter_email") return "recruiter-email";
  if (kind === "call_transcript") return "call";
  return "recruiter";
}

export async function processIntake(intakeId: string): Promise<IntakeResult> {
  const row = await intakeRepo.getById(intakeId);
  if (!row) return { intakeId, action: "skipped", reason: "not found" };
  if (row.status !== "pending") {
    return { intakeId, action: "skipped", reason: row.status };
  }

  try {
    const ex = await extract(row.kind, row.rawText);

    if (ex.isRecruitment === false) {
      await intakeRepo.markStatus(intakeId, "processed");
      return { intakeId, action: "skipped_non_recruitment" };
    }

    const company = clean(ex.company);
    const position = clean(ex.position);
    if (!company || !position) {
      await intakeRepo.markStatus(intakeId, "needs_review", {
        errorMessage: "missing company or position",
      });
      return {
        intakeId,
        action: "needs_review",
        reason: "missing company/position",
      };
    }

    const jobUrl = `recruitment://${slug(company)}-${slug(position)}`;
    const { score, priority, reasons } = scoreRecruitment({
      rate: ex.rate,
      salaryRange: ex.salaryRange,
      workModel: ex.workModel,
      techStack: ex.techStack,
      flags: ex.flags,
      notes: ex.notes,
    });
    const suitabilityReason = [clean(ex.flags), reasons.join("; ") || undefined]
      .filter(Boolean)
      .join(" — ");
    const stage = normalizeStage(ex.stage);
    const existing = await getJobByUrl(jobUrl);

    let jobId: string;
    let action: IntakeAction;

    if (existing) {
      await updateJob(existing.id, {
        location: clean(ex.location) ?? undefined,
        salary: clean(ex.salaryRange) ?? clean(ex.rate) ?? undefined,
        isRemote: isRemote(ex.workModel),
        suitabilityScore: score,
        suitabilityReason: suitabilityReason || undefined,
      });
      await createJobNote({
        jobId: existing.id,
        title: `Update (${row.kind})`,
        content: noteBody(ex, row.kind),
      });
      jobId = existing.id;
      action = "updated";
    } else {
      const job = await createJob({
        source: channelSource(row.kind),
        title: position,
        employer: company,
        jobUrl,
        location: clean(ex.location),
        salary: clean(ex.salaryRange) ?? clean(ex.rate),
        skills: ex.techStack?.length ? ex.techStack.join(", ") : undefined,
        isRemote: isRemote(ex.workModel),
        applicationLink: clean(ex.jobPostUrl),
      });
      await updateJob(job.id, {
        suitabilityScore: score,
        suitabilityReason: suitabilityReason || undefined,
      });
      await createJobNote({
        jobId: job.id,
        title: `Intake (${row.kind})`,
        content: noteBody(ex, row.kind),
      });
      jobId = job.id;
      action = "created";
    }

    transitionStage(jobId, stage);

    const nextAction = clean(ex.nextAction);
    if (nextAction) {
      await createTask(jobId, nextAction, toEpochSeconds(ex.nextActionDue));
    }

    if (row.kind === "call_transcript" && ex.isTechInterview) {
      await recordStudyTopics(jobId, ex, priority);
    }

    await intakeRepo.markStatus(intakeId, "processed", { jobId });
    logger.info(`intake ${action} (${row.kind}): job ${jobId} <- ${intakeId}`);
    return { intakeId, action, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await intakeRepo.markStatus(intakeId, "error", { errorMessage: message });
    logger.error(`intake processing failed (${intakeId}): ${message}`);
    return { intakeId, action: "error", reason: message };
  }
}

export async function processPending(limit = 25): Promise<IntakeResult[]> {
  const pending = await intakeRepo.listPending(limit);
  const results: IntakeResult[] = [];
  for (const row of pending) {
    results.push(await processIntake(row.id));
  }
  return results;
}
