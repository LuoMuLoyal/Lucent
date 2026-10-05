import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type { ClinicSummaryDto } from '../../dto/clinic-summary-response.dto.js';
import {
  CONTENT_WIDTH,
  MARGIN_X,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TOP_Y,
} from '../../../data-export/index.js';
import type { PageContext } from '../../../data-export/index.js';
import {
  ensureSpace,
  drawSectionTitle,
  drawPageDecorations,
  drawPageChrome,
  wrapText,
  CJK_FONT_PATH,
} from '../../../data-export/index.js';
import type { ClinicSummaryOptions } from './summary.service.js';
import { ClinicSummaryService } from './summary.service.js';
import {
  drawFindingsSection,
  drawProfileTable,
  drawAllergiesSection,
  drawConditionsSection,
  drawMedicinesSection,
} from './clinical-drawers.js';
import {
  drawWaterSection,
  drawSleepSection,
  drawNotesSection,
} from './record-drawers.js';
import {
  createClinicSummaryPdfTranslator,
  type ClinicSummaryTranslator,
} from './pdf-copy.js';

@Injectable()
export class ClinicSummaryPdfService {
  constructor(
    private readonly summaryService: ClinicSummaryService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Export the caller's clinic summary as PDF. The summary view is built by
   * `ClinicSummaryService` (shared with preview/share paths so the export
   * never drifts from what the owner sees); this service renders it.
   */
  async exportPdf(
    userId: string,
    locale: string,
    options: ClinicSummaryOptions = {},
  ): Promise<Buffer> {
    const summary = await this.summaryService.buildClinicSummary(
      userId,
      locale,
      options,
    );
    return this.buildPdf(summary, locale);
  }

  /**
   * Export a shared clinic summary as PDF. Returns null when the share token
   * is missing, expired or revoked (mirrors `getSharedSummary`'s public-read
   * gate).
   */
  async exportSharedPdf(token: string, locale: string): Promise<Buffer | null> {
    const summary = await this.summaryService.getSharedSummary(token);
    if (!summary) return null;
    return this.buildPdf(summary, locale);
  }

  async buildPdf(summary: ClinicSummaryDto, locale: string): Promise<Buffer> {
    const t = createClinicSummaryPdfTranslator(this.i18n, locale);

    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const fontBytes = await readFile(CJK_FONT_PATH);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: false });

    const title = t('title');
    this.applyMetadata(pdf, title, summary, t);

    const headerSubtitle = t('header', {
      generatedAt: summary.generatedAt,
      dataRange: summary.dataRange,
    });
    // Footer disclaimer: data comes from the user's records, may be
    // incomplete, and is not a substitute for diagnosis. It never claims a
    // doctor reviewed the summary.
    const footerNote = t('footer_note');
    const pageNumberLabel = t('page_number');
    const kindLabel = t('kind');

    const context: PageContext = {
      pdf,
      cjkFont,
      page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      cursorY: TOP_Y,
      title,
      headerSubtitle,
      footerNote,
      pageNumberLabel,
      kindLabel,
    };
    drawPageChrome(context);

    // Sections render only when present: the service already applies the
    // shared selected-field view model, so deselected sections arrive as
    // absent keys and must not produce content (or crash on `.length`).
    if (summary.profile != null) {
      drawSectionTitle(context, t('section.profile'));
      drawProfileTable(context, summary.profile, t, cjkFont);
      context.cursorY -= 12;
    }

    if (summary.allergies != null) {
      drawSectionTitle(context, t('section.allergies'));
      drawAllergiesSection(context, summary.allergies, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.conditions != null) {
      drawSectionTitle(context, t('section.conditions'));
      drawConditionsSection(context, summary.conditions, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.currentMedicines != null) {
      drawSectionTitle(context, t('section.medicines'));
      drawMedicinesSection(context, summary.currentMedicines, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.findings != null && summary.findings.length > 0) {
      drawSectionTitle(context, t('section.findings'));
      drawFindingsSection(context, summary.findings, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.waterEntries != null && summary.waterEntries.length > 0) {
      drawSectionTitle(context, t('section.water'));
      drawWaterSection(context, summary.waterEntries, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.sleepEntries != null && summary.sleepEntries.length > 0) {
      drawSectionTitle(context, t('section.sleep'));
      drawSleepSection(context, summary.sleepEntries, t, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.noteEntries != null && summary.noteEntries.length > 0) {
      drawSectionTitle(context, t('section.notes'));
      drawNotesSection(context, summary.noteEntries, t, cjkFont);
      context.cursorY -= 8;
    }

    // ── Disclaimer ─────────────────────────────────────────
    const disclaimerText = t('disclaimer_line', {
      disclaimer: summary.disclaimer,
    });
    context.cursorY -= 6;
    const disclaimerLines = wrapText(disclaimerText, cjkFont, 9, CONTENT_WIDTH);
    ensureSpace(context, disclaimerLines.length, 4);
    for (const line of disclaimerLines) {
      context.page.drawText(line, {
        x: MARGIN_X,
        y: context.cursorY,
        size: 9,
        font: cjkFont,
        color: rgb(0.4, 0.45, 0.52),
      });
      context.cursorY -= 13;
    }

    drawPageDecorations(context);
    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private applyMetadata(
    pdf: PDFDocument,
    title: string,
    summary: ClinicSummaryDto,
    t: ClinicSummaryTranslator,
  ): void {
    const subject = t('metadata_subject', { dataRange: summary.dataRange });
    const generatedAt = new Date(summary.generatedAt);
    pdf.setTitle(title, { showInWindowTitleBar: true });
    pdf.setAuthor('Lumos / Lucent');
    pdf.setSubject(subject);
    pdf.setCreator('Lucent Clinic Summary Export Service');
    pdf.setProducer('Lucent Clinic Summary Export Service');
    if (!Number.isNaN(generatedAt.getTime())) {
      pdf.setCreationDate(generatedAt);
      pdf.setModificationDate(generatedAt);
    }
  }
}
