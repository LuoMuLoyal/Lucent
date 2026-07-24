import { rgb } from 'pdf-lib';
import {
  BOTTOM_Y,
  CONTENT_WIDTH,
  FOOTER_RULE_Y,
  FOOTER_TEXT_Y,
  HEADER_RULE_Y,
  HEADER_TOP_Y,
  MARGIN_X,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TOP_Y,
} from '../../constants/report-pdf.constants';
import type {
  EmbeddedFont,
  PageContext,
} from '../../constants/report-pdf.constants';
import { statusLabel, statusPalette } from '../../utils/report-pdf.theme';
import { metricLabel } from '../../utils/report-pdf.theme';
import type {
  ReportDashboardDataDto,
  ReportMetricDto,
  ReportTrendDto,
} from '../../../reports';

export type PdfColor = ReturnType<typeof rgb>;

export function ensureHeight(context: PageContext, height: number): void {
  if (context.cursorY - height >= BOTTOM_Y) return;
  context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  context.cursorY = TOP_Y;
  drawPageChrome(context);
}

export function ensureSpace(
  context: PageContext,
  lineCount: number,
  extraPadding = 0,
): void {
  const neededHeight = lineCount * 15 + extraPadding;
  ensureHeight(context, neededHeight);
}

export function drawSectionTitle(context: PageContext, title: string): void {
  ensureSpace(context, 1, 6);
  context.page.drawText(title, {
    x: MARGIN_X,
    y: context.cursorY,
    size: 14,
    font: context.cjkFont,
    color: rgb(0.15, 0.22, 0.32),
  });
  context.cursorY -= 20;
}

export function drawSubsectionTitle(context: PageContext, title: string): void {
  ensureSpace(context, 1);
  context.page.drawText(title, {
    x: MARGIN_X,
    y: context.cursorY,
    size: 11,
    font: context.cjkFont,
    color: rgb(0.34, 0.41, 0.5),
  });
  context.cursorY -= 16;
}

export function drawWrappedText(
  context: PageContext,
  text: string,
  size: number,
  font: EmbeddedFont,
  maxWidth: number,
): void {
  const lines = wrapText(text, font, size, maxWidth);
  for (const line of lines) {
    ensureSpace(context, 1);
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

/**
 * Formats sparkline values as a space-separated string, truncating from the
 * right (most recent) so the result fits within `maxWidth` at size 8.
 */
function truncateSparkline(
  font: EmbeddedFont,
  values: number[],
  maxWidth: number,
): string {
  const parts: string[] = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (v === undefined) continue;
    const formatted = Number.isInteger(v) ? String(v) : v.toFixed(1);
    const candidate =
      parts.length === 0 ? formatted : `${formatted} ${parts.join(' ')}`;
    if (font.widthOfTextAtSize(candidate, 8) <= maxWidth) {
      parts.unshift(formatted);
    } else {
      parts.unshift('…');
      break;
    }
  }
  return parts.join(' ');
}

function buildScoreBreakdown(
  metrics: ReportMetricDto[],
  isZh: boolean,
): string {
  const parts = metrics.map((m) => {
    const label = metricLabel(m.kind, isZh);
    const score = metricScoreValue(m.status);
    const sign = score >= 0 ? '+' : '';
    return `${label} ${sign}${String(score)}`;
  });
  return parts.join('  |  ');
}

/**
 * Maps a metric status to a numeric score for the score breakdown.
 * `insufficient_data` and unknown statuses return 0 (unscored) so they
 * never appear healthier than `needs_attention`.
 */
function metricScoreValue(status: string): number {
  switch (status) {
    case 'good':
      return 35;
    case 'stable':
      return 25;
    case 'needs_attention':
      return 15;
    default:
      return 0;
  }
}

export function drawScoreCard(
  context: PageContext,
  report: ReportDashboardDataDto,
  isZh: boolean,
): void {
  const palette = statusPalette(report.score.status);
  const summaryLines = wrapText(
    report.score.summary,
    context.cjkFont,
    11,
    CONTENT_WIDTH - 28,
  );
  const breakdownText = buildScoreBreakdown(report.metrics, isZh);
  const boxHeight = 68 + summaryLines.length * 15;
  ensureHeight(context, boxHeight);
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
  const statusText = statusLabel(report.score.status, isZh);
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
  context.page.drawText(breakdownText, {
    x: MARGIN_X + 14,
    y: context.cursorY - 54,
    size: 9.5,
    font: context.cjkFont,
    color: rgb(0.4, 0.45, 0.53),
  });
  let textY = context.cursorY - 74;
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

export function drawMetricsGrid(
  context: PageContext,
  metrics: ReportMetricDto[],
  isZh: boolean,
): void {
  const cols = 2;
  const cardWidth = (CONTENT_WIDTH - 8) / cols;
  const cardHeight = 76;
  for (let i = 0; i < metrics.length; i += cols) {
    const row = metrics.slice(i, i + cols);
    const boxHeight = cardHeight;
    ensureHeight(context, boxHeight);
    const boxY = context.cursorY - boxHeight;
    for (let j = 0; j < row.length; j += 1) {
      const metric = row[j];
      if (!metric) continue;
      const x = MARGIN_X + j * (cardWidth + 8);
      drawCompactMetricCard(
        context,
        metric,
        isZh,
        x,
        boxY,
        cardWidth,
        cardHeight,
      );
    }
    context.cursorY = boxY - 8;
  }
}

function drawCompactMetricCard(
  context: PageContext,
  metric: ReportMetricDto,
  isZh: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const palette = statusPalette(metric.status);
  const label = metricLabel(metric.kind, isZh);
  const statusText = statusLabel(metric.status, isZh);
  const valueText = `${metric.value}${metric.unit}`;
  context.page.drawRectangle({
    x,
    y,
    width,
    height,
    color: palette.fill,
    borderColor: palette.border,
    borderWidth: 0.8,
  });
  context.page.drawText(label, {
    x: x + 10,
    y: y + height - 16,
    size: 10,
    font: context.cjkFont,
    color: rgb(0.34, 0.41, 0.5),
  });
  context.page.drawText(valueText, {
    x: x + 10,
    y: y + height - 36,
    size: 18,
    font: context.cjkFont,
    color: rgb(0.14, 0.19, 0.26),
  });
  context.page.drawText(statusText, {
    x: x + width - context.cjkFont.widthOfTextAtSize(statusText, 10) - 10,
    y: y + height - 16,
    size: 10,
    font: context.cjkFont,
    color: palette.text,
  });
  const deltaLabel = deltaText(metric, isZh);
  context.page.drawText(deltaLabel, {
    x: x + 10,
    y: y + height - 50,
    size: 9,
    font: context.cjkFont,
    color: rgb(0.34, 0.41, 0.5),
  });
  const sparklineText = truncateSparkline(
    context.cjkFont,
    metric.sparkline,
    width - 20,
  );
  context.page.drawText(sparklineText, {
    x: x + 10,
    y: y + height - 64,
    size: 8,
    font: context.cjkFont,
    color: rgb(0.45, 0.49, 0.55),
  });
}

function deltaText(metric: ReportMetricDto, isZh: boolean): string {
  const prefix = isZh ? 'Δ:' : 'Δ:';
  if (metric.delta === '--') return `${prefix} --`;
  const arrow =
    metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '→';
  return `${prefix} ${metric.delta} ${arrow}`;
}

export function drawInsightBlock(
  context: PageContext,
  input: {
    title: string;
    body: string;
    accentColor: PdfColor;
    backgroundColor: PdfColor;
    badgeText?: string;
    badgeColor?: PdfColor;
    sparkline?: number[];
  },
): void {
  const titleLines = wrapText(
    input.title,
    context.cjkFont,
    11,
    CONTENT_WIDTH - 28,
  );
  const bodyLines = wrapText(
    input.body,
    context.cjkFont,
    11,
    CONTENT_WIDTH - 28,
  );
  const badgeHeight = input.badgeText ? 20 : 0;
  const sparklineHeight = input.sparkline ? 18 : 0;
  const boxHeight =
    14 +
    badgeHeight +
    titleLines.length * 15 +
    bodyLines.length * 15 +
    sparklineHeight +
    18;
  ensureHeight(context, boxHeight);
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
  if (input.sparkline) {
    const sparklineText = truncateSparkline(
      context.cjkFont,
      input.sparkline,
      CONTENT_WIDTH - 28,
    );
    context.page.drawText(sparklineText, {
      x: MARGIN_X + 14,
      y: textY,
      size: 8,
      font: context.cjkFont,
      color: rgb(0.5, 0.54, 0.6),
    });
    textY -= 18;
  }
  context.cursorY = boxY - 8;
}

export function wrapText(
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
    if (current) lines.push(current);
    current = char;
  }
  if (current) lines.push(current);
  return lines;
}

export function drawTrendTable(
  context: PageContext,
  trends: ReportTrendDto[],
  isZh: boolean,
): void {
  if (trends.length === 0) return;
  const maxLen = Math.max(...trends.map((t) => t.values.length), 0);
  if (maxLen === 0) return;

  const dayColWidth = 44;
  const metricColWidth = (CONTENT_WIDTH - dayColWidth) / trends.length;
  const rowHeight = 15;
  const headerHeight = 18;

  ensureHeight(context, headerHeight + rowHeight);
  const headerY = context.cursorY;
  drawRowBackground(
    context,
    MARGIN_X,
    headerY - headerHeight,
    CONTENT_WIDTH,
    headerHeight,
    rgb(0.94, 0.96, 0.98),
  );
  const dateLabel = isZh ? '日期' : 'Day';
  context.page.drawText(dateLabel, {
    x: MARGIN_X + 4,
    y: headerY - 13,
    size: 8.5,
    font: context.cjkFont,
    color: rgb(0.22, 0.27, 0.33),
  });
  for (let ci = 0; ci < trends.length; ci += 1) {
    const trend = trends[ci];
    if (!trend) continue;
    const label = `${metricLabel(trend.kind, isZh)}(${trend.unit})`;
    const colX = MARGIN_X + dayColWidth + ci * metricColWidth;
    context.page.drawText(label, {
      x: colX + 4,
      y: headerY - 13,
      size: 8.5,
      font: context.cjkFont,
      color: rgb(0.22, 0.27, 0.33),
    });
  }
  context.cursorY = headerY - headerHeight;

  for (let row = 0; row < maxLen; row += 1) {
    ensureSpace(context, 1, 2);
    const bgY = context.cursorY - rowHeight;
    if (row % 2 === 0) {
      drawRowBackground(
        context,
        MARGIN_X,
        bgY,
        CONTENT_WIDTH,
        rowHeight,
        rgb(0.97, 0.98, 0.99),
      );
    }
    const dayNum = isZh ? `第${String(row + 1)}天` : `Day ${String(row + 1)}`;
    context.page.drawText(dayNum, {
      x: MARGIN_X + 4,
      y: bgY + 3,
      size: 8,
      font: context.cjkFont,
      color: rgb(0.4, 0.45, 0.53),
    });
    for (let ci = 0; ci < trends.length; ci += 1) {
      const trend = trends[ci];
      if (!trend) continue;
      const colX = MARGIN_X + dayColWidth + ci * metricColWidth;
      const value = trend.values[row];
      const valueText =
        value == null
          ? '--'
          : Number.isInteger(value)
            ? String(value)
            : value.toFixed(1);
      context.page.drawText(valueText, {
        x: colX + 6,
        y: bgY + 3,
        size: 8,
        font: context.cjkFont,
        color: rgb(0.22, 0.27, 0.33),
      });
    }
    context.cursorY = bgY;
  }
  context.cursorY -= 8;
}

function drawRowBackground(
  context: PageContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: PdfColor,
): void {
  context.page.drawRectangle({
    x,
    y,
    width,
    height,
    color,
    borderWidth: 0,
  });
}

export function drawPageChrome(context: PageContext): void {
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

export function drawPageDecorations(context: PageContext): void {
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
