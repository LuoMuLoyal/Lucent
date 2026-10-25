/**
 * 报表 PDF 渲染端口 —— 应用层不依赖 PDF 库与字体资源。
 *
 * ## 为什么是端口
 *
 * 渲染 PDF（pdfkit、CJK 字体嵌入、分页排版）是**基础设施**：它依赖具体库、
 * 具体字体文件路径，且完全没有业务判断。应用层只需要「给我三种报表之一的
 * PDF 字节」。
 *
 * 三种 kind 各自一个方法而不是一个带 `kind` 参数的通用方法：这样调用方
 * 的 switch 留在**应用层**（那是产品决策：哪种 kind 渲染成哪张表），
 * 而实现层只负责「怎么画」。
 */
import type { ReportDashboardDataDto } from '../../../reports/index.js';

/** 渲染所需的最小输入。 */
export interface ReportRenderInput {
  locale: string;
  report: ReportDashboardDataDto;
}

export abstract class ReportPdf {
  /** 医院/院区报表（默认）。 */
  abstract buildHospitalPdf(input: ReportRenderInput): Promise<Buffer>;

  /** 月度汇总报表。 */
  abstract buildMonthlyPdf(input: ReportRenderInput): Promise<Buffer>;

  /** 打印友好报表。 */
  abstract buildPrintPdf(input: ReportRenderInput): Promise<Buffer>;
}
