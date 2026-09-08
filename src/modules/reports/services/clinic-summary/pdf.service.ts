import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

// `require.resolve` is unavailable in ESM — createRequire keeps the ability to
// resolve a package asset path inside node_modules.
const nodeRequire = createRequire(import.meta.url);
const FONT_PATH = nodeRequire.resolve(
  '@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf',
);

@Injectable()
export class ClinicSummaryPdfService {
  constructor(private readonly summaryService: ClinicSummaryService) {}

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
    const isZh = locale.toLowerCase().startsWith('zh');

    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);
    const fontBytes = await readFile(FONT_PATH);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: false });

    const title = isZh ? 'Lumos 就诊摘要' : 'Lumos Clinic Summary';
    this.applyMetadata(pdf, title, summary, isZh);

    const headerSubtitle = isZh
      ? `生成时间：${summary.generatedAt}  ·  数据范围：${summary.dataRange}`
      : `Generated at: ${summary.generatedAt}  ·  Data range: ${summary.dataRange}`;
    // Footer disclaimer: data comes from the user's records, may be
    // incomplete, and is not a substitute for diagnosis. It never claims a
    // doctor reviewed the summary.
    const footerNote = isZh
      ? '资料来自用户记录，可能不完整，仅供就诊参考，不能代替专业医疗诊断。'
      : "Data comes from the user's records, may be incomplete, and is not a substitute for professional medical diagnosis.";
    const pageNumberLabel = isZh
      ? '第 {{page}} / {{total}} 页'
      : 'Page {{page}} / {{total}}';
    const kindLabel = isZh ? '就诊摘要' : 'Clinic Summary';

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
      drawSectionTitle(context, isZh ? '个人信息' : 'Personal Information');
      drawProfileTable(context, summary.profile, isZh, cjkFont);
      context.cursorY -= 12;
    }

    if (summary.allergies != null) {
      drawSectionTitle(context, isZh ? '过敏史' : 'Allergies');
      drawAllergiesSection(context, summary.allergies, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.conditions != null) {
      drawSectionTitle(context, isZh ? '既往病史' : 'Medical Conditions');
      drawConditionsSection(context, summary.conditions, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.currentMedicines != null) {
      drawSectionTitle(context, isZh ? '当前用药' : 'Current Medicines');
      drawMedicinesSection(context, summary.currentMedicines, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.findings != null && summary.findings.length > 0) {
      drawSectionTitle(context, isZh ? '要点发现' : 'Key Findings');
      drawFindingsSection(context, summary.findings, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.waterEntries != null && summary.waterEntries.length > 0) {
      drawSectionTitle(context, isZh ? '饮水记录' : 'Water Intake');
      drawWaterSection(context, summary.waterEntries, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.sleepEntries != null && summary.sleepEntries.length > 0) {
      drawSectionTitle(context, isZh ? '睡眠记录' : 'Sleep');
      drawSleepSection(context, summary.sleepEntries, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.noteEntries != null && summary.noteEntries.length > 0) {
      drawSectionTitle(context, isZh ? '备注' : 'Notes');
      drawNotesSection(context, summary.noteEntries, isZh, cjkFont);
      context.cursorY -= 8;
    }

    // ── Disclaimer ─────────────────────────────────────────
    const disclaimerText = isZh
      ? `免责声明：${summary.disclaimer}`
      : `Disclaimer: ${summary.disclaimer}`;
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
    isZh: boolean,
  ): void {
    const subject = isZh
      ? `就诊摘要，生成时间 ${summary.generatedAt}`
      : `Clinic Summary, generated at ${summary.generatedAt}`;
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
