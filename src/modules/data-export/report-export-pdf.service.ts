import fontkit from '@pdf-lib/fontkit';
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import type { ReportDashboardDataDto } from '../reports/dto';

const FONT_PATH =
  require.resolve('@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf');

@Injectable()
export class ReportExportPdfService {
  async buildHospitalPdf(input: {
    locale: string;
    report: ReportDashboardDataDto;
  }): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);

    const [fontBytes, regularFont] = await Promise.all([
      readFile(FONT_PATH),
      pdf.embedFont(StandardFonts.Helvetica),
    ]);
    const cjkFont = await pdf.embedFont(fontBytes, { subset: true });

    const page = pdf.addPage([595.28, 841.89]);
    const marginX = 48;
    let cursorY = 790;

    const isZh = input.locale.toLowerCase().startsWith('zh');
    const title = isZh ? 'Lumos 医疗就诊报告' : 'Lumos Hospital Report';
    const summaryLabel = isZh ? '概览' : 'Overview';
    const metricsLabel = isZh ? '关键指标' : 'Key Metrics';
    const findingsLabel = isZh ? '发现' : 'Findings';
    const patternsLabel = isZh ? '模式' : 'Patterns';

    page.drawText(title, {
      x: marginX,
      y: cursorY,
      size: 24,
      font: cjkFont,
      color: rgb(0.1, 0.16, 0.24),
    });
    cursorY -= 26;

    page.drawText(
      `${isZh ? '统计范围' : 'Range'}: ${input.report.startDate} ~ ${input.report.endDate}`,
      {
        x: marginX,
        y: cursorY,
        size: 11,
        font: cjkFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    cursorY -= 16;

    page.drawText(
      `${isZh ? '生成时间' : 'Generated at'}: ${input.report.generatedAt}`,
      {
        x: marginX,
        y: cursorY,
        size: 11,
        font: regularFont,
        color: rgb(0.35, 0.4, 0.48),
      },
    );
    cursorY -= 30;

    cursorY = this.drawSectionTitle(
      page,
      summaryLabel,
      marginX,
      cursorY,
      cjkFont,
    );
    cursorY = this.drawWrappedText(
      page,
      `${isZh ? '健康评分' : 'Health score'}: ${String(input.report.score.value)}/${String(input.report.score.maxValue)} (${input.report.score.status})`,
      marginX,
      cursorY,
      11,
      cjkFont,
      500,
    );
    cursorY = this.drawWrappedText(
      page,
      input.report.score.summary,
      marginX,
      cursorY,
      11,
      cjkFont,
      500,
    );
    cursorY -= 8;

    cursorY = this.drawSectionTitle(
      page,
      metricsLabel,
      marginX,
      cursorY,
      cjkFont,
    );
    for (const metric of input.report.metrics) {
      cursorY = this.drawWrappedText(
        page,
        `${this.metricLabel(metric.kind, isZh)}: ${metric.value}${metric.unit} | ${this.statusLabel(metric.status, isZh)} | ${isZh ? '变化' : 'Delta'} ${metric.delta}`,
        marginX,
        cursorY,
        11,
        cjkFont,
        500,
      );
    }
    cursorY -= 8;

    cursorY = this.drawSectionTitle(
      page,
      findingsLabel,
      marginX,
      cursorY,
      cjkFont,
    );
    if (input.report.findings.length === 0) {
      cursorY = this.drawWrappedText(
        page,
        isZh
          ? '当前没有额外重点发现。'
          : 'No additional findings for this range.',
        marginX,
        cursorY,
        11,
        cjkFont,
        500,
      );
    } else {
      for (const finding of input.report.findings) {
        cursorY = this.drawWrappedText(
          page,
          `- ${finding.title}: ${finding.body}`,
          marginX,
          cursorY,
          11,
          cjkFont,
          500,
        );
      }
    }
    cursorY -= 8;

    cursorY = this.drawSectionTitle(
      page,
      patternsLabel,
      marginX,
      cursorY,
      cjkFont,
    );
    for (const pattern of input.report.patterns) {
      cursorY = this.drawWrappedText(
        page,
        `- ${pattern.title}: ${pattern.body}`,
        marginX,
        cursorY,
        11,
        cjkFont,
        500,
      );
    }

    const disclaimer = isZh
      ? '说明：本报告用于自我管理与就诊辅助，不替代医生诊断。'
      : 'Note: This report supports self-management and visits, and does not replace medical diagnosis.';
    page.drawText(disclaimer, {
      x: marginX,
      y: 40,
      size: 9,
      font: cjkFont,
      color: rgb(0.45, 0.49, 0.55),
    });

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private drawSectionTitle(
    page: ReturnType<PDFDocument['addPage']>,
    title: string,
    x: number,
    y: number,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  ): number {
    page.drawText(title, {
      x,
      y,
      size: 14,
      font,
      color: rgb(0.15, 0.22, 0.32),
    });
    return y - 20;
  }

  private drawWrappedText(
    page: ReturnType<PDFDocument['addPage']>,
    text: string,
    x: number,
    y: number,
    size: number,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    maxWidth: number,
  ): number {
    const lines = this.wrapText(text, font, size, maxWidth);
    for (const line of lines) {
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      y -= 15;
    }
    return y;
  }

  private wrapText(
    text: string,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
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
