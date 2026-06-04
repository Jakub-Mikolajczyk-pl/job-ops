import { logger } from "@infra/logger";
import * as jobDocumentsRepo from "@server/repositories/job-documents";
import * as jobsRepo from "@server/repositories/jobs";
import type {
  ApplicationPacketResponse,
  Job,
  JobDocument,
  JobNote,
  ResumeProfile,
} from "@shared/types";
import { storeJobDocument } from "./job-document-storage";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import { getProfile } from "./profile";
import { getWritingStyle } from "./writing-style";

export type ApplicationPacketContent = {
  fitSummaryMarkdown: string;
  coverLetterMarkdown: string;
  reviewMarkdown: string;
  checklistMarkdown: string;
  interviewPrepMarkdown: string;
};

export type ApplicationPacketResult =
  | { success: true; data: ApplicationPacketContent }
  | { success: false; error: string };

export type StoredApplicationPacket = {
  note: JobNote;
  documents: {
    coverLetter: JobDocument;
    review: JobDocument;
    interviewPrep: JobDocument;
  };
};

type DraftPacket = {
  fitSummaryMarkdown: string;
  coverLetterMarkdown: string;
  interviewPrepMarkdown: string;
};

type ReviewedPacket = {
  revisedCoverLetterMarkdown: string;
  reviewMarkdown: string;
  checklistMarkdown: string;
};

const DRAFT_SCHEMA: JsonSchemaDefinition = {
  name: "application_packet_draft",
  schema: {
    type: "object",
    properties: {
      fitSummaryMarkdown: { type: "string" },
      coverLetterMarkdown: { type: "string" },
      interviewPrepMarkdown: { type: "string" },
    },
    required: [
      "fitSummaryMarkdown",
      "coverLetterMarkdown",
      "interviewPrepMarkdown",
    ],
    additionalProperties: false,
  },
};

const REVIEW_SCHEMA: JsonSchemaDefinition = {
  name: "application_packet_review",
  schema: {
    type: "object",
    properties: {
      revisedCoverLetterMarkdown: { type: "string" },
      reviewMarkdown: { type: "string" },
      checklistMarkdown: { type: "string" },
    },
    required: [
      "revisedCoverLetterMarkdown",
      "reviewMarkdown",
      "checklistMarkdown",
    ],
    additionalProperties: false,
  },
};

export async function generateApplicationPacketContent(
  job: Job,
): Promise<ApplicationPacketResult> {
  const [model, profile, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getProfile(),
    getWritingStyle(),
  ]);
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  const llm = await createConfiguredLlmService("tailoring");
  const jobContext = buildJobContext(job);
  const profileContext = buildProfileContext(profile);

  const draftResult = await llm.callJson<DraftPacket>({
    model,
    messages: [
      {
        role: "user",
        content: buildDraftPrompt({
          jobContext,
          profileContext,
          outputLanguage,
          tone: writingStyle.tone,
          formality: writingStyle.formality,
          constraints: writingStyle.constraints,
          doNotUse: writingStyle.doNotUse,
        }),
      },
    ],
    jsonSchema: DRAFT_SCHEMA,
    jobId: job.id,
  });

  if (!draftResult.success) {
    logger.warn("Application packet draft failed", {
      jobId: job.id,
      error: draftResult.error,
    });
    return {
      success: false,
      error: `Application packet draft failed: ${draftResult.error}`,
    };
  }

  const draft = normalizeDraftPacket(draftResult.data);
  const reviewResult = await llm.callJson<ReviewedPacket>({
    model,
    messages: [
      {
        role: "user",
        content: buildReviewPrompt({
          jobContext,
          profileContext,
          outputLanguage,
          draft,
        }),
      },
    ],
    jsonSchema: REVIEW_SCHEMA,
    jobId: job.id,
  });

  if (!reviewResult.success) {
    logger.warn("Application packet review failed", {
      jobId: job.id,
      error: reviewResult.error,
    });
    return {
      success: false,
      error: `Application packet review failed: ${reviewResult.error}`,
    };
  }

  const reviewed = normalizeReviewedPacket(reviewResult.data);
  return {
    success: true,
    data: {
      fitSummaryMarkdown: draft.fitSummaryMarkdown,
      coverLetterMarkdown: reviewed.revisedCoverLetterMarkdown,
      reviewMarkdown: reviewed.reviewMarkdown,
      checklistMarkdown: reviewed.checklistMarkdown,
      interviewPrepMarkdown: draft.interviewPrepMarkdown,
    },
  };
}

export async function generateAndStoreApplicationPacket(
  job: Job,
): Promise<
  | { success: true; data: ApplicationPacketResponse }
  | { success: false; error: string }
> {
  const packet = await generateApplicationPacketContent(job);
  if (!packet.success) return packet;

  const [coverLetter, review, interviewPrep] = await Promise.all([
    storeMarkdownDocument({
      jobId: job.id,
      fileName: "application-cover-letter.md",
      markdown: packet.data.coverLetterMarkdown,
    }),
    storeMarkdownDocument({
      jobId: job.id,
      fileName: "application-review.md",
      markdown: [
        packet.data.fitSummaryMarkdown,
        packet.data.reviewMarkdown,
        packet.data.checklistMarkdown,
      ].join("\n\n"),
    }),
    storeMarkdownDocument({
      jobId: job.id,
      fileName: "application-interview-prep.md",
      markdown: packet.data.interviewPrepMarkdown,
    }),
  ]);

  const note = await jobsRepo.createJobNote({
    jobId: job.id,
    title: "Application Packet",
    content: buildPacketNoteContent({
      coverLetter,
      review,
      interviewPrep,
      packet: packet.data,
    }),
  });

  return {
    success: true,
    data: {
      note,
      documents: {
        coverLetter,
        review,
        interviewPrep,
      },
    },
  };
}

async function storeMarkdownDocument(args: {
  jobId: string;
  fileName: string;
  markdown: string;
}): Promise<JobDocument> {
  const stored = await storeJobDocument({
    jobId: args.jobId,
    fileName: args.fileName,
    mediaType: "text/markdown",
    dataBase64: Buffer.from(args.markdown, "utf8").toString("base64"),
  });

  return jobDocumentsRepo.createJobDocument({
    jobId: args.jobId,
    fileName: stored.fileName,
    mediaType: stored.mediaType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
  });
}

function buildPacketNoteContent(args: {
  coverLetter: JobDocument;
  review: JobDocument;
  interviewPrep: JobDocument;
  packet: ApplicationPacketContent;
}): string {
  return [
    "## Application Packet",
    "Generated first-class application materials for this job.",
    "### Documents",
    `- ${args.coverLetter.fileName}`,
    `- ${args.review.fileName}`,
    `- ${args.interviewPrep.fileName}`,
    args.packet.fitSummaryMarkdown,
    args.packet.checklistMarkdown,
  ].join("\n\n");
}

function buildJobContext(job: Job): string {
  return JSON.stringify(
    {
      id: job.id,
      title: job.title,
      employer: job.employer,
      location: job.location,
      salary: job.salary,
      suitabilityScore: job.suitabilityScore,
      suitabilityReason: job.suitabilityReason,
      jobBrief: parseMaybeJson(job.jobBrief),
      tailoredHeadline: job.tailoredHeadline,
      tailoredSummary: job.tailoredSummary,
      tailoredSkills: parseMaybeJson(job.tailoredSkills),
      description: truncate(job.jobDescription ?? "", 9000),
    },
    null,
    2,
  );
}

function buildProfileContext(profile: ResumeProfile): string {
  return JSON.stringify(
    {
      basics: {
        name: profile.basics?.name,
        label: profile.basics?.label ?? profile.basics?.headline,
        summary: profile.basics?.summary,
      },
      skills: profile.sections?.skills,
      experience: profile.sections?.experience?.items?.map((item) => ({
        company: item.company,
        position: item.position,
        summary: item.summary,
      })),
      projects: profile.sections?.projects?.items?.map((item) => ({
        name: item.name,
        description: item.description,
        keywords: item.keywords,
      })),
    },
    null,
    2,
  );
}

function buildDraftPrompt(args: {
  jobContext: string;
  profileContext: string;
  outputLanguage: string;
  tone: string;
  formality: string;
  constraints: string;
  doNotUse: string;
}): string {
  return `
You are creating a first-class job application packet.

Return JSON only. Write user-visible content in ${args.outputLanguage}.

Job context:
${args.jobContext}

Candidate profile:
${args.profileContext}

Writing style:
- Tone: ${args.tone}
- Formality: ${args.formality}
- Constraints: ${args.constraints || "None"}
- Avoid terms: ${args.doNotUse || "None"}

Tasks:
1. Write fitSummaryMarkdown: a concise fit summary with strengths, gaps, and what to emphasize.
2. Write coverLetterMarkdown: a ready-to-edit cover letter for this exact role. It must be grounded only in the profile and job context. Do not invent achievements, employment, credentials, salary facts, or company research.
3. Write interviewPrepMarkdown: practical interview prep with likely questions, answer angles, and questions for the interviewer.

Cover letter rules:
- Address the employer or hiring team.
- Lead with what the candidate can bring to the role.
- Mention gaps honestly by reframing adjacent experience.
- Keep it concise enough to paste into an application form.
`.trim();
}

function buildReviewPrompt(args: {
  jobContext: string;
  profileContext: string;
  outputLanguage: string;
  draft: DraftPacket;
}): string {
  return `
You are the reviewer pass for a job application packet.

Return JSON only. Write user-visible content in ${args.outputLanguage}.

Job context:
${args.jobContext}

Candidate profile:
${args.profileContext}

Draft fit summary:
${args.draft.fitSummaryMarkdown}

Draft cover letter:
${args.draft.coverLetterMarkdown}

Draft interview prep:
${args.draft.interviewPrepMarkdown}

Tasks:
1. Critique the draft for missed role keywords, weak framing, unsupported claims, generic language, and contradictions.
2. Produce revisedCoverLetterMarkdown with the critique applied.
3. Produce reviewMarkdown as a readable review report.
4. Produce checklistMarkdown as a final verification checklist.

Hard rules:
- Do not add any claim that is not supported by the profile or job context.
- If company-specific research is missing, say what to research instead of inventing it.
- The revised cover letter must stay concise and application-ready.
`.trim();
}

function normalizeDraftPacket(value: DraftPacket): DraftPacket {
  return {
    fitSummaryMarkdown: cleanMarkdown(
      value.fitSummaryMarkdown,
      "## Fit Summary",
    ),
    coverLetterMarkdown: cleanMarkdown(
      value.coverLetterMarkdown,
      "## Cover Letter",
    ),
    interviewPrepMarkdown: cleanMarkdown(
      value.interviewPrepMarkdown,
      "## Interview Prep",
    ),
  };
}

function normalizeReviewedPacket(value: ReviewedPacket): ReviewedPacket {
  return {
    revisedCoverLetterMarkdown: cleanMarkdown(
      value.revisedCoverLetterMarkdown,
      "## Cover Letter",
    ),
    reviewMarkdown: cleanMarkdown(
      value.reviewMarkdown,
      "## Application Review",
    ),
    checklistMarkdown: cleanMarkdown(value.checklistMarkdown, "## Checklist"),
  };
}

function cleanMarkdown(value: unknown, fallbackHeading: string): string {
  const text =
    typeof value === "string"
      ? value
          .replace(/^```(?:markdown|md)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim()
      : "";
  return text || `${fallbackHeading}\n\nNo content generated.`;
}

function parseMaybeJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}
