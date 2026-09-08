import { rgb } from 'pdf-lib';
import { MARGIN_X } from '../../../data-export/index.js';
import type { EmbeddedFont, PageContext } from '../../../data-export/index.js';
import { ensureSpace } from '../../../data-export/index.js';
import type {
  ClinicSummaryProfileDto,
  ClinicSummaryAllergyDto,
  ClinicSummaryConditionDto,
  ClinicSummaryMedicineDto,
} from '../../dto/clinic-summary-response.dto.js';

/** Fixed 资料不足 finding code — localized on the PDF instead of raw. */
export const INSUFFICIENT_COVERAGE_CODE = 'insufficient_coverage';

// ── Findings ──────────────────────────────────────────

export function drawFindingsSection(
  context: PageContext,
  findings: string[],
  isZh: boolean,
  font: EmbeddedFont,
): void {
  // Findings are structured fact/change codes reused from the event review
  // (Luminous localizes them in the UI); the PDF prints the codes verbatim
  // so it never fabricates copy. The single fixed 资料不足 statement
  // (`insufficient_coverage`) is rendered as localized text instead of a
  // raw code — it is the one finding whose meaning must be readable by a
  // doctor without the client.
  const codeLabel = (code: string): string =>
    code === INSUFFICIENT_COVERAGE_CODE
      ? isZh
        ? '资料不足'
        : 'Insufficient data'
      : code;
  for (const code of findings) {
    ensureSpace(context, 1);
    const rowY = context.cursorY;
    context.page.drawText(`• ${codeLabel(code)}`, {
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

// ── Profile ────────────────────────────────────────────

export function drawProfileTable(
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
  drawKeyValueTable(context, rows, font);
}

// ── Allergies ──────────────────────────────────────────

export function drawAllergiesSection(
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

// ── Conditions ─────────────────────────────────────────

export function drawConditionsSection(
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

// ── Medicines ──────────────────────────────────────────

export function drawMedicinesSection(
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

// ── Key-Value Table ────────────────────────────────────

export function drawKeyValueTable(
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
