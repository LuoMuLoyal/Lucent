/**
 * 列出某一天的日报记录（读用例）。
 *
 * 读侧直接由查询端口组装读模型（ADR-0024：读模型不建 repository、不承担不变量）。
 * 分页参数在 HTTP 层已按上限收敛，这里不再裁剪。
 */
import { Injectable } from '@nestjs/common';
import { parseDateOnly } from '../../../../common/index.js';
import { asDailyRecordKind } from '../../domain/record/record-kind.js';
import { DailyRecords } from '../../domain/record/records.js';
import type { RecordList } from '../read_models/record-list.js';
import { toRecordItem } from '../read_models/record-item.js';

/** 列表默认分页：一页条数（客户端按需覆盖，上限由 DTO 校验）。 */
const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class ListRecords {
  constructor(private readonly records: DailyRecords) {}

  async execute(
    userId: string,
    date: string,
    kind?: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<RecordList> {
    const asKind = kind == null ? undefined : asDailyRecordKind(kind);
    const result = await this.records.listPage(
      {
        userId,
        occurredAt: parseDateOnly(date),
        ...(asKind != null ? { kind: asKind } : {}),
      },
      { page, pageSize },
    );

    return {
      items: result.items.map((row) => toRecordItem(row)),
      total: result.total,
    };
  }
}
