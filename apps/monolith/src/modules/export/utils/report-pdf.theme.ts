import { rgb } from 'pdf-lib';
import type { ReportPdfKind } from '../constants/report-pdf.constants.js';
import type { PdfTranslator } from './pdf-copy.js';

type PdfColor = ReturnType<typeof rgb>;

/**
 * Label resolvers for the export PDF.
 *
 * These take a locale-bound translator rather than an `isZh` boolean: a boolean
 * cannot express a third language, and the previous inline ternaries kept the
 * copy out of the i18n dictionaries (see `pdf-copy.ts`).
 *
 * An unknown kind/metric/status falls back to the raw value, matching the
 * previous `default:` branches — an unrecognised value is a schema drift, and
 * showing it verbatim is more diagnosable than a generic label.
 */
export function kindLabel(kind: ReportPdfKind, t: PdfTranslator): string {
  switch (kind) {
    case 'hospital':
    case 'monthly':
    case 'print':
      return t(`kind.${kind}`);
  }
}

export function statusPalette(status: string): {
  fill: PdfColor;
  border: PdfColor;
  accent: PdfColor;
  text: PdfColor;
} {
  switch (status) {
    case 'good':
      return {
        fill: rgb(0.94, 0.98, 0.95),
        border: rgb(0.78, 0.9, 0.81),
        accent: rgb(0.19, 0.55, 0.33),
        text: rgb(0.19, 0.55, 0.33),
      };
    case 'stable':
      return {
        fill: rgb(0.95, 0.97, 0.99),
        border: rgb(0.82, 0.88, 0.94),
        accent: rgb(0.26, 0.44, 0.67),
        text: rgb(0.26, 0.44, 0.67),
      };
    case 'needs_attention':
      return {
        fill: rgb(1, 0.96, 0.94),
        border: rgb(0.95, 0.84, 0.78),
        accent: rgb(0.76, 0.33, 0.18),
        text: rgb(0.76, 0.33, 0.18),
      };
    case 'insufficient_data':
      return {
        fill: rgb(0.97, 0.97, 0.97),
        border: rgb(0.86, 0.86, 0.86),
        accent: rgb(0.47, 0.47, 0.47),
        text: rgb(0.47, 0.47, 0.47),
      };
    default:
      return {
        fill: rgb(0.97, 0.97, 0.97),
        border: rgb(0.86, 0.86, 0.86),
        accent: rgb(0.47, 0.47, 0.47),
        text: rgb(0.47, 0.47, 0.47),
      };
  }
}

export function metricLabel(kind: string, t: PdfTranslator): string {
  switch (kind) {
    case 'medication':
    case 'water':
    case 'sleep':
      return t(`metric.${kind}`);
    default:
      return kind;
  }
}

export function statusLabel(status: string, t: PdfTranslator): string {
  switch (status) {
    case 'good':
    case 'stable':
    case 'needs_attention':
    case 'insufficient_data':
      return t(`status.${status}`);
    default:
      return status;
  }
}
