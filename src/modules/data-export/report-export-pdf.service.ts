import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type { ReportDashboardDataDto } from '../reports/dto';

const FONT_PATH =
  require.resolve('@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf');
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const HEADER_TOP_Y = 804;
const HEADER_RULE_Y = 772;
const TOP_Y = 748;
const FOOTER_RULE_Y = 70;
const FOOTER_TEXT_Y = 52;
const BOTTOM_Y = 96;

type ReportPdfKind = 'hospital' | 'monthly' | 'print';

type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;
type PdfPage = ReturnType<PDFDocument['addPage']>;
type PdfColor = ReturnType<typeof rgb>;
type PageContext = {
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

@Injectable()
export class ReportExportPdfService {
  async buildHospitalPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const isZh = input.locale.toLowerCase().startsWith('zh');
    return this._buildPdf(
      'hospital',
      isZh ? 'Lumos 医疗就诊报告' : 'Lumos Hospital Report',
      input.report,
      isZh,
    );
  }

  async buildMonthlyPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const isZh = input.locale.toLowerCase().startsWith('zh');
    return this._buildPdf(
      'monthly',
      isZh ? 'Lumos 月度报告' : 'Lumos Monthly Report',
      input.report,
      isZh,
    );
  }

  async buildPrintPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const isZh = input.locale.toLowerCase().startsWith('zh');
    return this._buildPdf(
      'print',
      isZh ? 'Lumos 打印报告' : 'Lumos Print Report',
      input.report,
      isZh,
    );
  }

  private async _buildPdf(
    kind: ReportPdfKind,
    title: string,
    report: ReportDashboardDataDto,
    isZh: boolean,
  ): Promise<Buffer> {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.registerFontkit(fontkit);

    const fontBytes = await readFile(FONT_PATH);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: false });
    this.applyMetadata(pdf, title, kind, report, isZh);

    const headerSubtitle = `${isZh ? '统计范围' : 'Range'}: ${report.startDate} ~ ${report.endDate}`;
    const footerNote = isZh
      ? '说明：本报告用于自我管理与就诊辅助，不替代医生诊断。'
      : 'Note: This report supports self-management and visits, and does not replace medical diagnosis.';
    const pageNumberLabel = isZh
      ? '第 {{page}} / {{total}} 页'
      : 'Page {{page}} / {{total}}';
    const kindLabel = this.kindLabel(kind, isZh);
    const context = this.createPageContext({
      pdf,
      cjkFont,
      title,
      headerSubtitle,
      footerNote,
      pageNumberLabel,
      kindLabel,
    });

    const summaryLabel = isZh ? '概览' : 'Overview';
    const metricsLabel = isZh ? '关键指标' : 'Key Metrics';
    const findingsLabel = isZh ? '发现' : 'Findings';
    const patternsLabel = isZh ? '模式' : 'Patterns';

    this.ensureSpace(context, 1);
    context.page.drawText(kindLabel, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 11,
      font: cjkFont,
      color: rgb(0.29, 0.36, 0.46),
    });
    context.cursorY -= 20;

    this.ensureSpace(context, 1);
    context.page.drawText(
      `${isZh ? '生成时间' : 'Generated at'}: ${report.generatedAt}`,
      {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font: cjkFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    context.cursorY -= 30;

    this.drawSectionTitle(context, summaryLabel);
    this.drawScoreCard(context, report, isZh);
    context.cursorY -= 8;

    this.drawSectionTitle(context, metricsLabel);
    for (const metric of report.metrics) {
      this.drawMetricCard(context, metric, isZh);
    }
    context.cursorY -= 8;

    this.drawSectionTitle(context, findingsLabel);
    if (report.findings.length === 0) {
      this.drawWrappedText(
        context,
        isZh
          ? '当前没有额外重点发现。'
          : 'No additional findings for this range.',
        11,
        cjkFont,
        CONTENT_WIDTH,
      );
    } else {
      for (const finding of report.findings) {
        this.drawInsightBlock(context, {
          title: finding.title,
          body: finding.body,
          accentColor: rgb(0.32, 0.45, 0.6),
          backgroundColor: rgb(0.96, 0.98, 1),
        });
      }
    }
    context.cursorY -= 8;

    this.drawSectionTitle(context, patternsLabel);
    const attentionPatterns = report.patterns.filter(
      (pattern) => pattern.status === 'needs_attention',
    );
    const otherPatterns = report.patterns.filter(
      (pattern) => pattern.status !== 'needs_attention',
    );

    if (attentionPatterns.length === 0 && otherPatterns.length === 0) {
      this.drawWrappedText(
        context,
        isZh
          ? '当前没有额外模式信息。'
          : 'No additional patterns for this range.',
        11,
        cjkFont,
        CONTENT_WIDTH,
      );
    }

    if (attentionPatterns.length > 0) {
      this.drawSubsectionTitle(
        context,
        isZh ? '需优先关注' : 'Needs Attention First',
      );
      for (const pattern of attentionPatterns) {
        const palette = this.statusPalette(pattern.status);
        this.drawInsightBlock(context, {
          title: pattern.title,
          body: pattern.body,
          accentColor: palette.accent,
          backgroundColor: palette.fill,
          badgeText: this.statusLabel(pattern.status, isZh),
          badgeColor: palette.text,
        });
      }
    }

    if (otherPatterns.length > 0) {
      this.drawSubsectionTitle(context, isZh ? '其余模式' : 'Other Patterns');
      for (const pattern of otherPatterns) {
        const palette = this.statusPalette(pattern.status);
        this.drawInsightBlock(context, {
          title: pattern.title,
          body: pattern.body,
          accentColor: palette.accent,
          backgroundColor: palette.fill,
          badgeText: this.statusLabel(pattern.status, isZh),
          badgeColor: palette.text,
        });
      }
    }

    this.drawPageDecorations(context);

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private applyMetadata(
    pdf: PDFDocument,
    title: string,
    kind: ReportPdfKind,
    report: ReportDashboardDataDto,
    isZh: boolean,
  ): void {
    const kindLabel = this.kindLabel(kind, isZh);
    const subject = isZh
      ? `${kindLabel}，统计范围 ${report.startDate} ~ ${report.endDate}`
      : `${kindLabel}, range ${report.startDate} ~ ${report.endDate}`;
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
    this.drawPageChrome(context);
    return context;
  }

  private ensureSpace(
    context: PageContext,
    lineCount: number,
    extraPadding = 0,
  ): void {
    const neededHeight = lineCount * 15 + extraPadding;
    this.ensureHeight(context, neededHeight);
  }

  private ensureHeight(context: PageContext, height: number): void {
    if (context.cursorY - height >= BOTTOM_Y) {
      return;
    }

    context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    context.cursorY = TOP_Y;
    this.drawPageChrome(context);
  }

  private drawSectionTitle(context: PageContext, title: string): void {
    this.ensureSpace(context, 1, 6);
    context.page.drawText(title, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 14,
      font: context.cjkFont,
      color: rgb(0.15, 0.22, 0.32),
    });
    context.cursorY -= 20;
  }

  private drawSubsectionTitle(context: PageContext, title: string): void {
    this.ensureSpace(context, 1);
    context.page.drawText(title, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 11,
      font: context.cjkFont,
      color: rgb(0.34, 0.41, 0.5),
    });
    context.cursorY -= 16;
  }

  private drawWrappedText(
    context: PageContext,
    text: string,
    size: number,
    font: EmbeddedFont,
    maxWidth: number,
  ): void {
    const lines = this.wrapText(text, font, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(context, 1);
      context.page.drawText(line, {
        x: MARGIN_X,
        y: context.cursorY,
        size,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 15;
    }
  }

  private drawScoreCard(
    context: PageContext,
    report: ReportDashboardDataDto,
    isZh: boolean,
  ): void {
    const palette = this.statusPalette(report.score.status);
    const summaryLines = this.wrapText(
      report.score.summary,
      context.cjkFont,
      11,
      CONTENT_WIDTH - 28,
    );
    const boxHeight = 52 + summaryLines.length * 15;
    this.ensureHeight(context, boxHeight);

    const boxY = context.cursorY - boxHeight;
    context.page.drawRectangle({
      x: MARGIN_X,
      y: boxY,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: palette.fill,
      borderColor: palette.border,
      borderWidth: 0.8,
    });
    context.page.drawRectangle({
      x: MARGIN_X,
      y: boxY,
      width: 4,
      height: boxHeight,
      color: palette.accent,
    });

    const scoreLabel = isZh ? '健康评分' : 'Health score';
    const scoreValue = `${String(report.score.value)} / ${String(report.score.maxValue)}`;
    const statusText = this.statusLabel(report.score.status, isZh);
    const valueWidth = context.cjkFont.widthOfTextAtSize(scoreValue, 22);
    const valueX = PAGE_WIDTH - MARGIN_X - 16 - valueWidth;

    context.page.drawText(scoreLabel, {
      x: MARGIN_X + 14,
      y: context.cursorY - 18,
      size: 11,
      font: context.cjkFont,
      color: rgb(0.34, 0.41, 0.5),
    });
    context.page.drawText(statusText, {
      x: MARGIN_X + 14,
      y: context.cursorY - 38,
      size: 14,
      font: context.cjkFont,
      color: palette.text,
    });
    context.page.drawText(scoreValue, {
      x: valueX,
      y: context.cursorY - 34,
      size: 22,
      font: context.cjkFont,
      color: rgb(0.14, 0.19, 0.26),
    });

    let textY = context.cursorY - 58;
    for (const line of summaryLines) {
      context.page.drawText(line, {
        x: MARGIN_X + 14,
        y: textY,
        size: 11,
        font: context.cjkFont,
        color: rgb(0.22, 0.27, 0.33),
      });
      textY -= 15;
    }

    context.cursorY = boxY - 10;
  }

  private drawMetricCard(
    context: PageContext,
    metric: ReportDashboardDataDto['metrics'][number],
    isZh: boolean,
  ): void {
    const palette = this.statusPalette(metric.status);
    const boxHeight = 56;
    this.ensureHeight(context, boxHeight);

    const boxY = context.cursorY - boxHeight;
    context.page.drawRectangle({
      x: MARGIN_X,
      y: boxY,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: palette.fill,
      borderColor: palette.border,
      borderWidth: 0.8,
    });

    const label = this.metricLabel(metric.kind, isZh);
    const statusText = this.statusLabel(metric.status, isZh);
    const valueText = `${metric.value}${metric.unit}`;
    const deltaText = `${isZh ? '变化' : 'Delta'} ${metric.delta}`;
    const statusWidth = context.cjkFont.widthOfTextAtSize(statusText, 10);
    const deltaWidth = context.cjkFont.widthOfTextAtSize(deltaText, 10);

    context.page.drawText(label, {
      x: MARGIN_X + 14,
      y: context.cursorY - 18,
      size: 11,
      font: context.cjkFont,
      color: rgb(0.34, 0.41, 0.5),
    });
    context.page.drawText(statusText, {
      x: PAGE_WIDTH - MARGIN_X - 14 - statusWidth,
      y: context.cursorY - 18,
      size: 10,
      font: context.cjkFont,
      color: palette.text,
    });
    context.page.drawText(valueText, {
      x: MARGIN_X + 14,
      y: context.cursorY - 40,
      size: 18,
      font: context.cjkFont,
      color: rgb(0.14, 0.19, 0.26),
    });
    context.page.drawText(deltaText, {
      x: PAGE_WIDTH - MARGIN_X - 14 - deltaWidth,
      y: context.cursorY - 38,
      size: 10,
      font: context.cjkFont,
      color: palette.text,
    });

    context.cursorY = boxY - 8;
  }

  private drawInsightBlock(
    context: PageContext,
    input: {
      title: string;
      body: string;
      accentColor: PdfColor;
      backgroundColor: PdfColor;
      badgeText?: string;
      badgeColor?: PdfColor;
    },
  ): void {
    const titleLines = this.wrapText(
      input.title,
      context.cjkFont,
      11,
      CONTENT_WIDTH - 28,
    );
    const bodyLines = this.wrapText(
      input.body,
      context.cjkFont,
      11,
      CONTENT_WIDTH - 28,
    );
    const badgeHeight = input.badgeText ? 20 : 0;
    const boxHeight =
      14 + badgeHeight + titleLines.length * 15 + bodyLines.length * 15 + 18;
    this.ensureHeight(context, boxHeight);

    const boxY = context.cursorY - boxHeight;
    context.page.drawRectangle({
      x: MARGIN_X,
      y: boxY,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: input.backgroundColor,
      borderColor: rgb(0.88, 0.91, 0.95),
      borderWidth: 0.8,
    });
    context.page.drawRectangle({
      x: MARGIN_X,
      y: boxY,
      width: 4,
      height: boxHeight,
      color: input.accentColor,
    });

    let textY = context.cursorY - 18;
    if (input.badgeText && input.badgeColor) {
      context.page.drawText(input.badgeText, {
        x: MARGIN_X + 14,
        y: textY,
        size: 10,
        font: context.cjkFont,
        color: input.badgeColor,
      });
      textY -= 20;
    }

    for (const line of titleLines) {
      context.page.drawText(line, {
        x: MARGIN_X + 14,
        y: textY,
        size: 11,
        font: context.cjkFont,
        color: rgb(0.14, 0.19, 0.26),
      });
      textY -= 15;
    }

    textY -= 2;
    for (const line of bodyLines) {
      context.page.drawText(line, {
        x: MARGIN_X + 14,
        y: textY,
        size: 11,
        font: context.cjkFont,
        color: rgb(0.22, 0.27, 0.33),
      });
      textY -= 15;
    }

    context.cursorY = boxY - 8;
  }

  private wrapText(
    text: string,
    font: EmbeddedFont,
    size: number,
    maxWidth: number,
  ): string[] {
    const lines: string[] = [];
    let current = '';

    for (const char of text) {
      const candidate = current + char;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }
      current = char;
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  private drawPageChrome(context: PageContext): void {
    context.page.drawText(context.title, {
      x: MARGIN_X,
      y: HEADER_TOP_Y,
      size: 17,
      font: context.cjkFont,
      color: rgb(0.1, 0.16, 0.24),
    });
    context.page.drawText(context.headerSubtitle, {
      x: MARGIN_X,
      y: 786,
      size: 9,
      font: context.cjkFont,
      color: rgb(0.4, 0.45, 0.53),
    });
    context.page.drawLine({
      start: { x: MARGIN_X, y: HEADER_RULE_Y },
      end: { x: PAGE_WIDTH - MARGIN_X, y: HEADER_RULE_Y },
      thickness: 1,
      color: rgb(0.86, 0.89, 0.93),
    });
  }

  private drawPageDecorations(context: PageContext): void {
    const totalPages = context.pdf.getPageCount();
    for (let index = 0; index < totalPages; index += 1) {
      const page = context.pdf.getPage(index);
      page.drawLine({
        start: { x: MARGIN_X, y: FOOTER_RULE_Y },
        end: { x: PAGE_WIDTH - MARGIN_X, y: FOOTER_RULE_Y },
        thickness: 1,
        color: rgb(0.86, 0.89, 0.93),
      });
      page.drawText(context.footerNote, {
        x: MARGIN_X,
        y: FOOTER_TEXT_Y,
        size: 8.5,
        font: context.cjkFont,
        color: rgb(0.45, 0.49, 0.55),
      });

      const pageNumber = context.pageNumberLabel
        .replace('{{page}}', String(index + 1))
        .replace('{{total}}', String(totalPages));
      const pageNumberWidth = context.cjkFont.widthOfTextAtSize(pageNumber, 9);
      page.drawText(pageNumber, {
        x: PAGE_WIDTH - MARGIN_X - pageNumberWidth,
        y: FOOTER_TEXT_Y,
        size: 9,
        font: context.cjkFont,
        color: rgb(0.45, 0.49, 0.55),
      });
    }
  }

  private kindLabel(kind: ReportPdfKind, isZh: boolean): string {
    switch (kind) {
      case 'hospital':
        return isZh ? '导出类型：医疗就诊报告' : 'Export type: Hospital report';
      case 'monthly':
        return isZh ? '导出类型：月度报告' : 'Export type: Monthly report';
      case 'print':
        return isZh ? '导出类型：打印报告' : 'Export type: Print report';
    }
  }

  private statusPalette(
    status: ReportDashboardDataDto['metrics'][number]['status'],
  ): {
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
    }
  }

  private metricLabel(
    kind: ReportDashboardDataDto['metrics'][number]['kind'],
    isZh: boolean,
  ): string {
    switch (kind) {
      case 'medication':
        return isZh ? '服药完成度' : 'Medication adherence';
      case 'water':
        return isZh ? '饮水' : 'Hydration';
      case 'sleep':
        return isZh ? '睡眠' : 'Sleep';
    }
  }

  private statusLabel(
    status: ReportDashboardDataDto['metrics'][number]['status'],
    isZh: boolean,
  ): string {
    switch (status) {
      case 'good':
        return isZh ? '良好' : 'Good';
      case 'stable':
        return isZh ? '稳定' : 'Stable';
      case 'needs_attention':
        return isZh ? '需关注' : 'Needs attention';
      case 'insufficient_data':
        return isZh ? '数据不足' : 'Insufficient data';
    }
  }
}
