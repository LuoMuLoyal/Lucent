import { createRequire } from 'node:module';

/**
 * Shared CJK font resolution for all PDF-generation services.
 *
 * `require.resolve` is unavailable in ESM — `createRequire` keeps the ability
 * to resolve a package asset path inside `node_modules`. Both
 * `ReportExportPdfService` (data-export) and `ClinicSummaryPdfService`
 * (reports) import this single path so the `@fontpkg` package name is never
 * duplicated across modules.
 */
const nodeRequire = createRequire(import.meta.url);
export const CJK_FONT_PATH = nodeRequire.resolve(
  '@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf',
);
