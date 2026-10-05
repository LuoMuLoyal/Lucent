import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { resolveLocale } from '../../../../common/index.js';
import type { ReportDashboardDataDto } from '../../../reports/index.js';
import {
  kindLabel,
  statusLabel,
  statusPalette,
} from '../../utils/report-pdf.theme.js';
import { CJK_FONT_PATH } from '../../pdf-fonts.js';
import {
  createPdfTranslator,
  type PdfTranslator,
} from '../../utils/pdf-copy.js';
import {
  CONTENT_WIDTH,
  MARGIN_X,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TOP_Y,
} from '../../constants/report-pdf.constants.js';
import type {
  EmbeddedFont,
  PageContext,
} from '../../constants/report-pdf.constants.js';
import {
  drawInsightBlock,
  drawMetricsGrid,
  drawPageChrome,
  drawPageDecorations,
  drawSectionTitle,
  drawSubsectionTitle,
  drawTrendTable,
  drawWrappedText,
  ensureSpace,
} from './draw.service.js';

type ReportPdfKind = 'hospital' | 'monthly' | 'print';

@Injectable()
export class ReportExportPdfService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * Binds the PDF copy namespace for one locale.
   *
   * The locale is normalized once here so every downstream renderer shares one
   * language, and a third language needs no per-call-site change.
   */
  private translatorFor(locale: string): PdfTranslator {
    return createPdfTranslator(this.i18n, resolveLocale(locale));
  }

  async buildHospitalPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const t = this.translatorFor(input.locale);
    return this.buildPdf('hospital', t('title.hospital'), input.report, t);
  }

  async buildMonthlyPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const t = this.translatorFor(input.locale);
    return this.buildPdf('monthly', t('title.monthly'), input.report, t);
  }

  async buildPrintPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const t = this.translatorFor(input.locale);
    return this.buildPdf('print', t('title.print'), input.report, t);
  }

  private async buildPdf(
    kind: ReportPdfKind,
    title: string,
    report: ReportDashboardDataDto,
    t: PdfTranslator,
  ): Promise<Buffer> {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const fontBytes = await readFile(CJK_FONT_PATH);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: false });
    this.applyMetadata(pdf, title, kind, report, t);

    const headerSubtitle = t('header.range_and_generated', {
      start: report.startDate,
      end: report.endDate,
      generatedAt: report.generatedAt,
    });
    const footerNote = t('footer_note');
    const pageNumberLabel = t('page_number');
    const kindLabelText = kindLabel(kind, t);
    const context = this.createPageContext({
      pdf,
      cjkFont,
      title,
      headerSubtitle,
      footerNote,
      pageNumberLabel,
      kindLabel: kindLabelText,
    });

    const summaryLabel = t('section.overview');
    const metricsLabel = t('section.metrics');
    const findingsLabel = t('section.findings');
    const patternsLabel = t('section.patterns');

    ensureSpace(context, 1);
    context.page.drawText(kindLabelText, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 11,
      font: cjkFont,
      color: rgb(0.29, 0.36, 0.46),
    });
    context.cursorY -= 20;

    ensureSpace(context, 1);
    context.page.drawText(
      `${t('header.generated_at')}: ${report.generatedAt}`,
      {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font: cjkFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    context.cursorY -= 30;

    drawSectionTitle(context, summaryLabel);
    context.cursorY -= 2;
    drawWrappedText(context, t('overview_body'), 9, cjkFont, CONTENT_WIDTH);
    context.cursorY -= 10;

    drawSectionTitle(context, metricsLabel);
    if (report.metrics.length > 0) drawMetricsGrid(context, report.metrics, t);
    context.cursorY -= 8;

    const trendsLabel = t('section.trends');
    drawSectionTitle(context, trendsLabel);
    drawTrendTable(context, report.trends, t);
    context.cursorY -= 8;

    drawSectionTitle(context, findingsLabel);
    if (report.findings.length === 0) {
      drawWrappedText(context, t('empty.findings'), 11, cjkFont, 500);
    } else {
      for (const finding of report.findings) {
        drawInsightBlock(context, {
          title: finding.title,
          body: finding.body,
          accentColor: rgb(0.32, 0.45, 0.6),
          backgroundColor: rgb(0.96, 0.98, 1),
        });
      }
    }
    context.cursorY -= 8;

    drawSectionTitle(context, patternsLabel);
    const attentionPatterns = report.patterns.filter(
      (p) => p.status === 'needs_attention',
    );
    const otherPatterns = report.patterns.filter(
      (p) => p.status !== 'needs_attention',
    );
    if (attentionPatterns.length === 0 && otherPatterns.length === 0) {
      drawWrappedText(context, t('empty.patterns'), 11, cjkFont, 500);
    }
    if (attentionPatterns.length > 0) {
      drawSubsectionTitle(context, t('subsection.needs_attention'));
      for (const pattern of attentionPatterns) {
        const palette = statusPalette(pattern.status);
        drawInsightBlock(context, {
          title: pattern.title,
          body: pattern.body,
          accentColor: palette.accent,
          backgroundColor: palette.fill,
          badgeText: statusLabel(pattern.status, t),
          badgeColor: palette.text,
          sparkline: pattern.sparkline,
        });
      }
    }
    if (otherPatterns.length > 0) {
      drawSubsectionTitle(context, t('subsection.other_patterns'));
      for (const pattern of otherPatterns) {
        const palette = statusPalette(pattern.status);
        drawInsightBlock(context, {
          title: pattern.title,
          body: pattern.body,
          accentColor: palette.accent,
          backgroundColor: palette.fill,
          badgeText: statusLabel(pattern.status, t),
          badgeColor: palette.text,
          sparkline: pattern.sparkline,
        });
      }
    }
    drawPageDecorations(context);
    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private applyMetadata(
    pdf: PDFDocument,
    title: string,
    kind: ReportPdfKind,
    report: ReportDashboardDataDto,
    t: PdfTranslator,
  ): void {
    const subject = t('metadata.subject', {
      kind: kindLabel(kind, t),
      start: report.startDate,
      end: report.endDate,
    });
    const generatedAt = new Date(report.generatedAt);
    pdf.setTitle(title, { showInWindowTitleBar: true });
    pdf.setAuthor('Lumos / Lucent');
    pdf.setSubject(subject);
    pdf.setCreator('Lucent Report Export Service');
    pdf.setProducer('Lucent Report Export Service');
    if (!Number.isNaN(generatedAt.getTime())) {
      pdf.setCreationDate(generatedAt);
      pdf.setModificationDate(generatedAt);
    }
  }

  private createPageContext(input: {
    pdf: PDFDocument;
    cjkFont: EmbeddedFont;
    title: string;
    headerSubtitle: string;
    footerNote: string;
    pageNumberLabel: string;
    kindLabel: string;
  }): PageContext {
    const context: PageContext = {
      ...input,
      page: input.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      cursorY: TOP_Y,
    };
    drawPageChrome(context);
    return context;
  }
}
