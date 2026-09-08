import { rgb } from 'pdf-lib';
import { CONTENT_WIDTH, MARGIN_X } from '../../../data-export/index.js';
import type { EmbeddedFont, PageContext } from '../../../data-export/index.js';
import { ensureSpace, wrapText } from '../../../data-export/index.js';
import type {
  ClinicSummaryWaterEntryDto,
  ClinicSummarySleepEntryDto,
  ClinicSummaryNoteEntryDto,
} from '../../dto/clinic-summary-response.dto.js';

// ── Water ──────────────────────────────────────────────

export function drawWaterSection(
  context: PageContext,
  entries: ClinicSummaryWaterEntryDto[],
  isZh: boolean,
  font: EmbeddedFont,
): void {
  const dateLabel = isZh ? '日期' : 'Date';
  const mlLabel = isZh ? '饮水量(ml)' : 'Intake (ml)';
  const dateW = 160;

  ensureSpace(context, 1, 6);
  const headerY = context.cursorY;
  context.page.drawText(dateLabel, {
    x: MARGIN_X,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.page.drawText(mlLabel, {
    x: MARGIN_X + dateW,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.cursorY -= 16;

  for (const e of entries) {
    ensureSpace(context, 1);
    const rowY = context.cursorY;
    context.page.drawText(e.date, {
      x: MARGIN_X,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.14, 0.19, 0.26),
    });
    context.page.drawText(String(e.ml), {
      x: MARGIN_X + dateW,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.22, 0.27, 0.33),
    });
    context.cursorY -= 17;
  }
}

// ── Sleep ──────────────────────────────────────────────

export function drawSleepSection(
  context: PageContext,
  entries: ClinicSummarySleepEntryDto[],
  isZh: boolean,
  font: EmbeddedFont,
): void {
  const dateLabel = isZh ? '日期' : 'Date';
  const durLabel = isZh ? '时长(分钟)' : 'Duration (min)';
  const dateW = 160;

  ensureSpace(context, 1, 6);
  const headerY = context.cursorY;
  context.page.drawText(dateLabel, {
    x: MARGIN_X,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.page.drawText(durLabel, {
    x: MARGIN_X + dateW,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.cursorY -= 16;

  for (const e of entries) {
    ensureSpace(context, 1);
    const rowY = context.cursorY;
    context.page.drawText(e.date, {
      x: MARGIN_X,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.14, 0.19, 0.26),
    });
    context.page.drawText(String(e.minutes), {
      x: MARGIN_X + dateW,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.22, 0.27, 0.33),
    });
    context.cursorY -= 17;
  }
}

// ── Notes ──────────────────────────────────────────────

export function drawNotesSection(
  context: PageContext,
  entries: ClinicSummaryNoteEntryDto[],
  isZh: boolean,
  font: EmbeddedFont,
): void {
  const dateLabel = isZh ? '日期' : 'Date';
  const kindLabel = isZh ? '类型' : 'Kind';
  const textLabel = isZh ? '备注' : 'Note';
  const dateW = 120;
  const kindW = 100;

  ensureSpace(context, 1, 6);
  const headerY = context.cursorY;
  context.page.drawText(dateLabel, {
    x: MARGIN_X,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.page.drawText(kindLabel, {
    x: MARGIN_X + dateW,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.page.drawText(textLabel, {
    x: MARGIN_X + dateW + kindW,
    y: headerY,
    size: 9,
    font,
    color: rgb(0.4, 0.45, 0.53),
  });
  context.cursorY -= 16;

  for (const e of entries) {
    const noteLines = wrapText(e.text, font, 10, CONTENT_WIDTH - dateW - kindW);
    ensureSpace(context, noteLines.length, 4);
    const rowY = context.cursorY;
    context.page.drawText(e.date, {
      x: MARGIN_X,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.14, 0.19, 0.26),
    });
    context.page.drawText(e.kind, {
      x: MARGIN_X + dateW,
      y: rowY,
      size: 11,
      font,
      color: rgb(0.22, 0.27, 0.33),
    });
    for (const line of noteLines) {
      context.page.drawText(line, {
        x: MARGIN_X + dateW + kindW,
        y: context.cursorY,
        size: 10,
        font,
        color: rgb(0.22, 0.27, 0.33),
      });
      context.cursorY -= 14;
    }
    context.cursorY -= 3;
  }
}
