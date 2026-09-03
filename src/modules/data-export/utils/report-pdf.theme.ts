import { rgb } from 'pdf-lib';
import type { ReportPdfKind } from '../constants/report-pdf.constants.js';

type PdfColor = ReturnType<typeof rgb>;

export function kindLabel(kind: ReportPdfKind, isZh: boolean): string {
  switch (kind) {
    case 'hospital':
      return isZh ? '导出类型：医疗就诊报告' : 'Export type: Hospital report';
    case 'monthly':
      return isZh ? '导出类型：月度报告' : 'Export type: Monthly report';
    case 'print':
      return isZh ? '导出类型：打印报告' : 'Export type: Print report';
  }
}

export function statusPalette(status: string): {
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
    default:
      return {
        fill: rgb(0.97, 0.97, 0.97),
        border: rgb(0.86, 0.86, 0.86),
        accent: rgb(0.47, 0.47, 0.47),
        text: rgb(0.47, 0.47, 0.47),
      };
  }
}

export function metricLabel(kind: string, isZh: boolean): string {
  switch (kind) {
    case 'medication':
      return isZh ? '服药完成度' : 'Medication adherence';
    case 'water':
      return isZh ? '饮水' : 'Hydration';
    case 'sleep':
      return isZh ? '睡眠' : 'Sleep';
    default:
      return kind;
  }
}

export function statusLabel(status: string, isZh: boolean): string {
  switch (status) {
    case 'good':
      return isZh ? '良好' : 'Good';
    case 'stable':
      return isZh ? '稳定' : 'Stable';
    case 'needs_attention':
      return isZh ? '需关注' : 'Needs attention';
    case 'insufficient_data':
      return isZh ? '数据不足' : 'Insufficient data';
    default:
      return status;
  }
}
