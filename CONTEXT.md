# JobOps — Context Glossary

Canonical domain language for JobOps. Glossary only — no implementation detail.

## Brag Document

A tenant-scoped, read-only-in-JobOps cache of an external **append-only bullet bank**
of dated, impact-focused accomplishments, fetched from the brain-memory project. It is
**supplementary input** to CV authoring (per-job Tailoring, Ghostwriter, and the Resume
Studio field assistant) — the LLM draws on it for real, concrete achievements.

- **Not** the Base Resume (it is not the structured CV source of record).
- **Not** a Job Document or Note (those are job-scoped; the Brag Document is tenant-scoped
  and shared across every job).
- Curated upstream in brain-memory and pulled into JobOps; JobOps never edits its content.

## Base Resume

The structured source-of-record CV for a tenant — either a local Design Resume (Resume
Studio) or a configured Reactive Resume. It is the skeleton that per-job Tailoring rewrites.
Distinct from the Brag Document, which only supplies achievement material, never structure.

## Tailoring

The per-job transformation that produces a job-specific headline, summary, and skills from
the Base Resume and job description (plus supplementary inputs such as the Brag Document),
rendered into the application PDF.

## Job Documents / Notes

Job-scoped context attached to a single application (uploaded files, notes, recruiter
emails) and selectable into the Ghostwriter chat. Scoped to one job — unlike the
tenant-scoped Brag Document.
