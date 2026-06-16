import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type { ReportDashboardDataDto } from '../reports/dto';

const FONT_PATH =
  require.resolve('@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf');
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const TOP_Y = 790;
const BOTTOM_Y = 64;

type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

@Injectable()
export class ReportExportPdfService {
  async buildHospitalPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const isZh = input.locale.toLowerCase().startsWith('zh');
    return this._buildPdf(
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
      isZh ? 'Lumos 打印报告' : 'Lumos Print Report',
      input.report,
      isZh,
    );
  }

  private async _buildPdf(
    title: string,
    report: ReportDashboardDataDto,
    isZh: boolean,
  ): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);

    const [fontBytes, regularFont] = await Promise.all([
      readFile(FONT_PATH),
      pdf.embedFont(StandardFonts.Helvetica),
    ]);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: true });

    const context = this.createPageContext(pdf, cjkFont);

    const summaryLabel = isZh ? '概览' : 'Overview';
    const metricsLabel = isZh ? '关键指标' : 'Key Metrics';
    const findingsLabel = isZh ? '发现' : 'Findings';
    const patternsLabel = isZh ? '模式' : 'Patterns';

    context.page.drawText(title, {
      x: MARGIN_X,
      y: context.cursorY,
      size: 24,
      font: cjkFont,
      color: rgb(0.1, 0.16, 0.24),
    });
    context.cursorY -= 26;

    this.ensureSpace(context, 1);
    context.page.drawText(
      `${isZh ? '统计范围' : 'Range'}: ${report.startDate} ~ ${report.endDate}`,
      {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font: cjkFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    context.cursorY -= 16;

    this.ensureSpace(context, 1);
    context.page.drawText(
      `${isZh ? '生成时间' : 'Generated at'}: ${report.generatedAt}`,
      {
        x: MARGIN_X,
        y: context.cursorY,
        size: 11,
        font: regularFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    context.cursorY -= 30;

    this.drawSectionTitle(context, summaryLabel);
    this.drawWrappedText(
      context,
      `${isZh ? '健康评分' : 'Health score'}: ${String(report.score.value)}/${String(report.score.maxValue)} (${report.score.status})`,
      11,
      cjkFont,
      500,
    );
    this.drawWrappedText(context, report.score.summary, 11, cjkFont, 500);
    context.cursorY -= 8;

    this.drawSectionTitle(context, metricsLabel);
    for (const metric of report.metrics) {
      this.drawWrappedText(
        context,
        `${this.metricLabel(metric.kind, isZh)}: ${metric.value}${metric.unit} | ${this.statusLabel(metric.status, isZh)} | ${isZh ? '变化' : 'Delta'} ${metric.delta}`,
        11,
        cjkFont,
        500,
      );
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
        500,
      );
    } else {
      for (const finding of report.findings) {
        this.drawWrappedText(
          context,
          `- ${finding.title}: ${finding.body}`,
          11,
          cjkFont,
          500,
        );
      }
    }
    context.cursorY -= 8;

    this.drawSectionTitle(context, patternsLabel);
    for (const pattern of report.patterns) {
      this.drawWrappedText(
        context,
        `- ${pattern.title}: ${pattern.body}`,
        11,
        cjkFont,
        500,
      );
    }

    const disclaimer = isZh
      ? '说明：本报告用于自我管理与就诊辅助，不替代医生诊断。'
      : 'Note: This report supports self-management and visits, and does not replace medical diagnosis.';
    context.page.drawText(disclaimer, {
      x: MARGIN_X,
      y: 40,
      size: 9,
      font: cjkFont,
      color: rgb(0.45, 0.49, 0.55),
    });

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private createPageContext(pdf: PDFDocument, cjkFont: EmbeddedFont) {
    return {
      pdf,
      cjkFont,
      page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      cursorY: TOP_Y,
    };
  }

  private ensureSpace(
    context: {
      pdf: PDFDocument;
      cjkFont: EmbeddedFont;
      page: ReturnType<PDFDocument['addPage']>;
      cursorY: number;
    },
    lineCount: number,
    extraPadding = 0,
  ): void {
    const neededHeight = lineCount * 15 + extraPadding;
    if (context.cursorY - neededHeight >= BOTTOM_Y) {
      return;
    }

    context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    context.cursorY = TOP_Y;
  }

  private drawSectionTitle(
    context: {
      pdf: PDFDocument;
      cjkFont: EmbeddedFont;
      page: ReturnType<PDFDocument['addPage']>;
      cursorY: number;
    },
    title: string,
  ): void {
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

  private drawWrappedText(
    context: {
      pdf: PDFDocument;
      cjkFont: EmbeddedFont;
      page: ReturnType<PDFDocument['addPage']>;
      cursorY: number;
    },
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
