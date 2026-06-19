import type { PDFDocument } from 'pdf-lib';

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN_X = 48;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
export const HEADER_TOP_Y = 804;
export const HEADER_RULE_Y = 772;
export const TOP_Y = 748;
export const FOOTER_RULE_Y = 70;
export const FOOTER_TEXT_Y = 52;
export const BOTTOM_Y = 96;

export type ReportPdfKind = 'hospital' | 'monthly' | 'print';

export type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;
export type PdfPage = ReturnType<PDFDocument['addPage']>;

export type PageContext = {
  pdf: PDFDocument;
  cjkFont: EmbeddedFont;
  page: PdfPage;
  cursorY: number;
  title: string;
  headerSubtitle: string;
  footerNote: string;
  pageNumberLabel: string;
  kindLabel: string;
};
