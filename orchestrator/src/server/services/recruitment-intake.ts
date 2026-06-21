/**
 * Recruitment intake worker (RECRUITMENT_TASKS.md R2).
 * Consumes a raw_intake row, extracts structured fields via the configured
 * LLM, classifies NEW vs UPDATE by a synthetic stable jobUrl, and upserts a
 * job + stage event + tasks (action points) + notes (+ interview study-topics
 * for tech-call transcripts). Idempotent: a processed row is never re-applied.
 *
 * Reuses the app's own LLM provider via ./modelSelection (same path as
 * interview-prep / ghostwriter) - no separate AI client.
 */

import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import {
  APPLICATION_STAGES,
  type ApplicationStage,
  type StageTransitionTarget,
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
  location: string;
  workMode: string;
  contractType: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  seniority: string;
  technologies: string[];
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  recruiterName: string;
  recruiterCompany: string;
  recruiterContact: string;
  sourceUrl: string;
  stage: string;
  nextAction: string;
  deadline: string;
  notes: string;
  confidence: string;
  isTechInterview: boolean;
  studyTopics: string[];
  hesitations: string[];
  concepts: string[];
}

export const REQUIRED_OUTPUT_KEYS = [
  "isRecruitment",
  "company",
  "position",
  "location",
  "workMode",
  "contractType",
  "salaryMin",
  "salaryMax",
  "currency",
  "seniority",
  "technologies",
  "responsibilities",
  "requirements",
  "benefits",
  "recruiterName",
  "recruiterCompany",
  "recruiterContact",
  "sourceUrl",
  "stage",
  "nextAction",
  "deadline",
  "notes",
  "confidence",
  "isTechInterview",
  "studyTopics",
  "hesitations",
  "concepts",
] as const;

const EXTRACTION_SCHEMA = {
  name: "recruitment_extraction",
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      isRecruitment: { type: "boolean" },
      company: { type: "string" },
      position: { type: "string" },
      location: { type: "string" },
      workMode: { type: "string" },
      contractType: { type: "string" },
      salaryMin: { type: "string" },
      salaryMax: { type: "string" },
      currency: { type: "string" },
      seniority: { type: "string" },
      technologies: { type: "array", items: { type: "string" } },
      responsibilities: { type: "array", items: { type: "string" } },
      requirements: { type: "array", items: { type: "string" } },
      benefits: { type: "array", items: { type: "string" } },
      recruiterName: { type: "string" },
      recruiterCompany: { type: "string" },
      recruiterContact: { type: "string" },
      sourceUrl: { type: "string" },
      stage: {
        type: "string",
        enum: ["no_change", ...APPLICATION_STAGES],
      },
      nextAction: { type: "string" },
      deadline: { type: "string" },
      notes: { type: "string" },
      confidence: { type: "string" },
      isTechInterview: { type: "boolean" },
      studyTopics: { type: "array", items: { type: "string" } },
      hesitations: { type: "array", items: { type: "string" } },
      concepts: { type: "array", items: { type: "string" } },
    },
    required: [...REQUIRED_OUTPUT_KEYS],
  },
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

function normalizeStage(stage?: string): StageTransitionTarget {
  if (stage === "no_change") return "no_change";
  return (APPLICATION_STAGES as readonly string[]).includes(stage ?? "")
    ? (stage as ApplicationStage)
    : "no_change";
}

function jobDescriptionFromIntake(
  kind: string,
  rawText: string,
): string | undefined {
  if (kind === "call_transcript") return undefined;
  return clean(rawText);
}

function buildPrompt(kind: string, rawText: string): string {
  return `You are Jakub's recruitment intake analyst. Extract structured data from the raw material below (a ${kind}). The input is usually Polish, sometimes English — read Polish fluently.

RULES:
- Return JSON with exactly these keys:
${REQUIRED_OUTPUT_KEYS.join(", ")}.
- Do NOT invent. If a field is not present, return an empty string (or empty array, or false for booleans). Never guess a rate or a person's name.
- "company": the HIRING company (the employer), even when only mentioned in passing — e.g. "w firmie ING" → "ING", "rola w Allegro" → "Allegro". This is NOT the recruitment agency.
- "recruiterCompany": the agency / pośrednik relaying the offer — e.g. "ze Scalo", "przez kontraktora Scalo" → "Scalo". Keep it separate from "company".
- "position": the role/title, even from conversational text — e.g. "na stanowisko FullStack Developer", "szukamy Senior Java Developera" → the role name.
- Extract company and position whenever they appear ANYWHERE in the text, including a single mention inside a sentence or an interview transcript. Only leave them blank if they are genuinely absent.
- Polish cues: salary "do 135 PLN/h", "20k netto B2B", "widełki 18-22k" → salaryMin/salaryMax/currency. Contract "B2B"/"UoP"/"zlecenie" → contractType. Work mode "zdalnie"/"100% zdalnie" = remote, "hybrydowo" = hybrid, "stacjonarnie" = on-site.
- "stage" MUST be one of the enum values. Use "no_change" unless the text explicitly says Jakub submitted an application or reached a later application stage. A recruiter message, job description, invitation to apply, or introductory outreach alone is "no_change".
- "isRecruitment": false if this is clearly NOT about a job opportunity (e.g. a private call, a video, unrelated chatter).
- If this is a technical/HR interview transcript, set "isTechInterview": true and fill studyTopics (concepts to study), hesitations (where the candidate struggled), concepts (technical terms mentioned).
- "nextAction": one concrete next step for Jakub.
- "deadline": ISO date if a deadline is implied, otherwise empty string.
- Use "notes" for recruiter context, red flags, and useful caveats.

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
    // Recruiter capture is async/unattended, so ride out transient provider
    // blips ("fetch failed", timeouts, 429/5xx) instead of dead-ending to
    // `error` on the first hiccup. Retry policy lives in llm/policies.
    maxRetries: 2,
    retryDelayMs: 500,
  });
  if (!result.success) {
    throw new Error(result.error ?? "LLM extraction failed");
  }
  if (!result.data) {
    throw new Error("LLM extraction returned no data");
  }
  const fallback = result.data as unknown as Record<string, unknown>;
  return {
    isRecruitment: result.data.isRecruitment === true,
    company: result.data.company ?? "",
    position: result.data.position ?? "",
    location: result.data.location ?? "",
    workMode:
      result.data.workMode ??
      (typeof fallback.workModel === "string" ? fallback.workModel : ""),
    contractType: result.data.contractType ?? "",
    salaryMin: result.data.salaryMin ?? "",
    salaryMax: result.data.salaryMax ?? "",
    currency: result.data.currency ?? "",
    seniority: result.data.seniority ?? "",
    technologies: Array.isArray(result.data.technologies)
      ? result.data.technologies
      : Array.isArray(fallback.techStack)
        ? (fallback.techStack as string[])
        : [],
    responsibilities: result.data.responsibilities ?? [],
    requirements: result.data.requirements ?? [],
    benefits: result.data.benefits ?? [],
    recruiterName: result.data.recruiterName ?? "",
    recruiterCompany:
      result.data.recruiterCompany ??
      (typeof fallback.agency === "string" ? fallback.agency : "") ??
      "",
    recruiterContact: result.data.recruiterContact ?? "",
    sourceUrl:
      result.data.sourceUrl ??
      (typeof fallback.jobPostUrl === "string" ? fallback.jobPostUrl : "") ??
      "",
    stage: result.data.stage ?? "no_change",
    nextAction: result.data.nextAction ?? "",
    deadline:
      result.data.deadline ??
      (typeof fallback.nextActionDue === "string"
        ? fallback.nextActionDue
        : "") ??
      "",
    notes:
      result.data.notes ??
      (typeof fallback.flags === "string" ? fallback.flags : "") ??
      "",
    confidence: result.data.confidence ?? "",
    isTechInterview: result.data.isTechInterview === true,
    studyTopics: result.data.studyTopics ?? [],
    hesitations: result.data.hesitations ?? [],
    concepts: result.data.concepts ?? [],
  };
}

function noteBody(ex: Extraction, kind: string): string {
  const salaryRange = [ex.salaryMin, ex.salaryMax].filter(Boolean).join("-");
  const lines = [
    `Source: ${kind}`,
    ex.recruiterName ? `Contact: ${ex.recruiterName}` : null,
    ex.recruiterCompany ? `Agency: ${ex.recruiterCompany}` : null,
    ex.recruiterContact ? `Recruiter contact: ${ex.recruiterContact}` : null,
    ex.contractType ? `Contract: ${ex.contractType}` : null,
    salaryRange ? `Range: ${salaryRange} ${ex.currency}`.trim() : null,
    ex.workMode ? `Work mode: ${ex.workMode}` : null,
    ex.seniority ? `Seniority: ${ex.seniority}` : null,
    ex.technologies.length ? `Tech: ${ex.technologies.join(", ")}` : null,
    ex.notes ? `\n${ex.notes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function isRemote(workMode?: string): boolean | undefined {
  const v = clean(workMode)?.toLowerCase();
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

function toSalaryDisplay(ex: Extraction): string | undefined {
  const salaryParts = [clean(ex.salaryMin), clean(ex.salaryMax)].filter(
    Boolean,
  );
  if (salaryParts.length === 0) return undefined;
  const range = salaryParts.join("-");
  const currency = clean(ex.currency);
  return currency ? `${range} ${currency}` : range;
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
    const salaryRange = [clean(ex.salaryMin), clean(ex.salaryMax)]
      .filter(Boolean)
      .join("-");
    const { score, priority, reasons } = scoreRecruitment({
      rate: clean(ex.salaryMax) ?? clean(ex.salaryMin),
      salaryRange,
      workModel: ex.workMode,
      techStack: ex.technologies,
      flags: clean(ex.notes),
      notes: ex.notes,
    });
    const suitabilityReason = [clean(ex.notes), reasons.join("; ") || undefined]
      .filter(Boolean)
      .join(" - ");
    const stage = normalizeStage(ex.stage);
    const existing = await getJobByUrl(jobUrl);

    let jobId: string;
    let action: IntakeAction;

    if (existing) {
      await updateJob(existing.id, {
        location: clean(ex.location) ?? undefined,
        salary: toSalaryDisplay(ex),
        isRemote: isRemote(ex.workMode),
        jobDescription:
          existing.jobDescription ??
          jobDescriptionFromIntake(row.kind, row.rawText),
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
        salary: toSalaryDisplay(ex),
        jobDescription: jobDescriptionFromIntake(row.kind, row.rawText),
        skills: ex.technologies?.length
          ? ex.technologies.join(", ")
          : undefined,
        isRemote: isRemote(ex.workMode),
        applicationLink: clean(ex.sourceUrl),
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

    if (stage !== "no_change") {
      transitionStage(jobId, stage);
    }

    const nextAction = clean(ex.nextAction);
    if (nextAction) {
      await createTask(jobId, nextAction, toEpochSeconds(ex.deadline));
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

export const __testExports = {
  buildPrompt,
  EXTRACTION_SCHEMA,
  REQUIRED_OUTPUT_KEYS,
};
