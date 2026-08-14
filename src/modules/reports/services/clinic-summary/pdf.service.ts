import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type {
  ClinicSummaryAllergyDto,
  ClinicSummaryConditionDto,
  ClinicSummaryMedicineDto,
  ClinicSummaryProfileDto,
} from '../../dto/clinic-summary-response.dto';
import type { ClinicSummarySectionView } from './summary-view.model';
import {
  CONTENT_WIDTH,
  MARGIN_X,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TOP_Y,
} from '../../../data-export';
import type { EmbeddedFont, PageContext } from '../../../data-export';
import {
  ensureSpace,
  drawSectionTitle,
  drawPageDecorations,
  drawPageChrome,
  wrapText,
} from '../../../data-export';

const FONT_PATH =
  require.resolve('@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf');

@Injectable()
export class ClinicSummaryPdfService {
  async buildPdf(
    summary: ClinicSummarySectionView,
    locale: string,
  ): Promise<Buffer> {
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
      this.drawProfileTable(context, summary.profile, isZh, cjkFont);
      context.cursorY -= 12;
    }

    if (summary.allergies != null) {
      drawSectionTitle(context, isZh ? '过敏史' : 'Allergies');
      this.drawAllergiesSection(context, summary.allergies, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.conditions != null) {
      drawSectionTitle(context, isZh ? '既往病史' : 'Medical Conditions');
      this.drawConditionsSection(context, summary.conditions, isZh, cjkFont);
      context.cursorY -= 8;
    }

    if (summary.currentMedicines != null) {
      drawSectionTitle(context, isZh ? '当前用药' : 'Current Medicines');
      this.drawMedicinesSection(
        context,
        summary.currentMedicines,
        isZh,
        cjkFont,
      );
      context.cursorY -= 8;
    }

    if (summary.findings != null && summary.findings.length > 0) {
      drawSectionTitle(context, isZh ? '要点发现' : 'Key Findings');
      this.drawFindingsSection(context, summary.findings, isZh, cjkFont);
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

  // ── Private drawing helpers ──────────────────────────────

  private drawFindingsSection(
    context: PageContext,
    findings: string[],
    isZh: boolean,
    font: EmbeddedFont,
  ): void {
    // Findings are structured fact/change codes reused from the event review
    // (Luminous localizes them in the UI); the PDF prints the codes verbatim
    // so it never fabricates copy.
    for (const code of findings) {
      ensureSpace(context, 1);
      const rowY = context.cursorY;
      context.page.drawText(`• ${code}`, {
        x: MARGIN_X,
        y: rowY,
        size: 10,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 16;
    }
    const note = isZh
      ? '以上要点来自用户记录的结构化事实与变化代码。'
      : 'These items are structured facts and change codes from the user records.';
    ensureSpace(context, 1);
    context.page.drawText(note, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.cursorY -= 14;
  }

  private drawProfileTable(
    context: PageContext,
    profile: ClinicSummaryProfileDto,
    isZh: boolean,
    font: EmbeddedFont,
  ): void {
    const p = profile;
    const rows: [string, string][] = [
      [isZh ? '昵称' : 'Nickname', p.nickname],
      [
        isZh ? '年龄' : 'Age',
        p.age != null
          ? `${String(p.age)} ${isZh ? '岁' : 'years'}`
          : isZh
            ? '未提供'
            : 'N/A',
      ],
      [isZh ? '性别' : 'Sex', p.sexAtBirth ?? (isZh ? '未提供' : 'N/A')],
      [isZh ? '血型' : 'Blood type', p.bloodType ?? (isZh ? '未提供' : 'N/A')],
    ];
    this.drawKeyValueTable(context, rows, font);
  }

  private drawAllergiesSection(
    context: PageContext,
    allergies: ClinicSummaryAllergyDto[],
    isZh: boolean,
    font: EmbeddedFont,
  ): void {
    if (allergies.length === 0) {
      const text = isZh ? '无已知过敏' : 'No known allergies';
      ensureSpace(context, 1);
      context.page.drawText(text, {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font,
        color: rgb(0.35, 0.4, 0.48),
      });
      context.cursorY -= 18;
      return;
    }

    const headerLabel = isZh ? '名称' : 'Name';
    const headerReaction = isZh ? '反应' : 'Reaction';
    const headerSeverity = isZh ? '严重程度' : 'Severity';
    const labelW = 140;
    const reactionW = 180;

    // Table header
    ensureSpace(context, 1, 6);
    const headerY = context.cursorY;
    context.page.drawText(headerLabel, {
      x: MARGIN_X,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawText(headerReaction, {
      x: MARGIN_X + labelW,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawText(headerSeverity, {
      x: MARGIN_X + labelW + reactionW,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.cursorY -= 16;

    for (const a of allergies) {
      ensureSpace(context, 1);
      const rowY = context.cursorY;
      context.page.drawText(a.label, {
        x: MARGIN_X,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.14, 0.19, 0.26),
      });
      context.page.drawText(a.reaction ?? (isZh ? '-' : '-'), {
        x: MARGIN_X + labelW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.page.drawText(a.severity ?? (isZh ? '-' : '-'), {
        x: MARGIN_X + labelW + reactionW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 17;
    }
  }

  private drawConditionsSection(
    context: PageContext,
    conditions: ClinicSummaryConditionDto[],
    isZh: boolean,
    font: EmbeddedFont,
  ): void {
    if (conditions.length === 0) {
      const text = isZh ? '无记录' : 'No recorded conditions';
      ensureSpace(context, 1);
      context.page.drawText(text, {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font,
        color: rgb(0.35, 0.4, 0.48),
      });
      context.cursorY -= 18;
      return;
    }

    const headerLabel = isZh ? '名称' : 'Name';
    const headerStatus = isZh ? '状态' : 'Status';
    const headerYear = isZh ? '确诊年份' : 'Diagnosed';
    const labelW = 160;
    const statusW = 140;

    ensureSpace(context, 1, 6);
    const headerY = context.cursorY;
    context.page.drawText(headerLabel, {
      x: MARGIN_X,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawText(headerStatus, {
      x: MARGIN_X + labelW,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawText(headerYear, {
      x: MARGIN_X + labelW + statusW,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.cursorY -= 16;

    for (const c of conditions) {
      ensureSpace(context, 1);
      const rowY = context.cursorY;
      context.page.drawText(c.label, {
        x: MARGIN_X,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.14, 0.19, 0.26),
      });
      context.page.drawText(c.status ?? '-', {
        x: MARGIN_X + labelW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      const yearStr = c.diagnosedYear != null ? String(c.diagnosedYear) : '-';
      context.page.drawText(yearStr, {
        x: MARGIN_X + labelW + statusW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 17;
    }
  }

  private drawMedicinesSection(
    context: PageContext,
    medicines: ClinicSummaryMedicineDto[],
    isZh: boolean,
    font: EmbeddedFont,
  ): void {
    if (medicines.length === 0) {
      const text = isZh ? '无当前用药' : 'No current medicines';
      ensureSpace(context, 1);
      context.page.drawText(text, {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font,
        color: rgb(0.35, 0.4, 0.48),
      });
      context.cursorY -= 18;
      return;
    }

    const headerName = isZh ? '药品名称' : 'Medicine';
    const headerDose = isZh ? '剂量' : 'Dosage';
    const nameW = 250;

    ensureSpace(context, 1, 6);
    const headerY = context.cursorY;
    context.page.drawText(headerName, {
      x: MARGIN_X,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawText(headerDose, {
      x: MARGIN_X + nameW,
      y: headerY,
      size: 9,
      font,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.cursorY -= 16;

    for (const m of medicines) {
      ensureSpace(context, 1);
      const rowY = context.cursorY;
      context.page.drawText(m.displayName, {
        x: MARGIN_X,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.14, 0.19, 0.26),
      });
      context.page.drawText(m.doseText ?? '-', {
        x: MARGIN_X + nameW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 17;
    }
  }

  private drawKeyValueTable(
    context: PageContext,
    rows: [string, string][],
    font: EmbeddedFont,
  ): void {
    const keyW = 80;

    for (const [key, value] of rows) {
      ensureSpace(context, 1);
      const rowY = context.cursorY;
      context.page.drawText(key, {
        x: MARGIN_X,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.4, 0.45, 0.53),
      });
      context.page.drawText(value, {
        x: MARGIN_X + keyW,
        y: rowY,
        size: 11,
        font,
        color: rgb(0.14, 0.19, 0.26),
      });
      context.cursorY -= 17;
    }
  }

  private applyMetadata(
    pdf: PDFDocument,
    title: string,
    summary: ClinicSummarySectionView,
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
