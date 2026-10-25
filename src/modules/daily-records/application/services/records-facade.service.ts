/**
 * `DailyRecordsService` 门面 —— 保持既有跨模块调用面，内部委托四层用例。
 *
 * ## 为什么保留这一层
 *
 * assistant 的提案确认与 `DAILY_RECORD_READER` 绑定都按 `DailyRecordsService`
 * 的形状调用（`create` / `update` / `delete` / `list` / `summary` / `get`）。
 * 它是**发布语言**的一部分，改名会牵动别的轨道；而真正的逻辑已经全在
 * `application/use_cases/`，这里只做转发，不承载任何规则。
 *
 * 依赖方向：本类只 import 应用层用例与端口，不碰 adapters / infrastructure。
 */
import { Injectable } from '@nestjs/common';
import type { CreateRecordInput, UpdateRecordInput } from './write-input.js';
import type {
  RecordItem,
  RecordList,
  RecordSummary,
} from '../read_models/record-list.js';
import { CreateRecord } from '../use_cases/create-record.js';
import { DeleteRecord } from '../use_cases/delete-record.js';
import { GetRecord } from '../use_cases/get-record.js';
import { GetSummary } from '../use_cases/get-summary.js';
import { ListRecords } from '../use_cases/list-records.js';
import { UpdateRecord } from '../use_cases/update-record.js';

@Injectable()
export class DailyRecordsService {
  constructor(
    private readonly listRecords: ListRecords,
    private readonly getRecord: GetRecord,
    private readonly getSummary: GetSummary,
    private readonly createRecord: CreateRecord,
    private readonly updateRecord: UpdateRecord,
    private readonly deleteRecord: DeleteRecord,
  ) {}

  list(
    userId: string,
    date: string,
    kind?: string,
    page?: number,
    pageSize?: number,
  ): Promise<RecordList> {
    return this.listRecords.execute(userId, date, kind, page, pageSize);
  }

  summary(userId: string, date: string): Promise<RecordSummary> {
    return this.getSummary.execute(userId, date);
  }

  get(userId: string, id: string) {
    return this.getRecord.execute(userId, id);
  }

  create(userId: string, dto: CreateRecordInput) {
    return this.createRecord.execute(userId, dto);
  }

  update(userId: string, id: string, dto: UpdateRecordInput) {
    return this.updateRecord.execute(userId, id, dto);
  }

  delete(userId: string, id: string) {
    return this.deleteRecord.execute(userId, id);
  }
}

export type { RecordItem };
