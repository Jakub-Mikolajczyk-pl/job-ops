/**
 * Ambient declarations for the root-level standalone scripts (RECRUITMENT_TASKS
 * R4/R5). They are plain ESM `.mjs` with no emitted types; these wildcard
 * module decls let the colocated vitest tests import their exported helpers
 * without a build step.
 */

declare module "*/scripts/intake-folder-watcher.mjs" {
  export function shouldSkip(filename: string): boolean;
  export function classifyFile(
    filename: string,
  ): { source: string; kind: string } | null;
  export function processFile(
    dir: string,
    filename: string,
    deps?: Record<string, unknown>,
  ): Promise<{ status: string; filename?: string; reason?: string }>;
  export function startWatcher(): Promise<void>;
}

declare module "*/scripts/migrate-notion-applications.mjs" {
  export function notionPropToText(prop: unknown): string;
  export function flattenPage(page: unknown): Record<string, string>;
  export function serializePage(page: unknown): string;
  export function buildCsv(
    records: { notionId: string; fields: Record<string, string> }[],
  ): string;
  export function runMigration(options?: Record<string, unknown>): Promise<{
    fetched: number;
    posted: number;
    deduped?: number;
    dryRun?: boolean;
  }>;
}
