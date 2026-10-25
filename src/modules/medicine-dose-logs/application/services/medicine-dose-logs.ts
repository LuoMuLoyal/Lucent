import { Injectable } from '@nestjs/common';

import type { DomainFailure } from '../../../../common/result/index.js';
import type { ResultAsync } from '../../../../common/result/index.js';
import type {
  CreateDoseLogCommand,
  DoseLogListResource,
  DoseLogResource,
  MarkDoseLogCommand,
  UpdateDoseLogCommand,
} from '../ports/dose-log-resource.js';
import type { DoseLogsForDate } from '../read_models/dose-logs-for-date.js';
import type { CreateDoseLog } from '../use_cases/create-dose-log.js';
import type { DeleteDoseLog } from '../use_cases/delete-dose-log.js';
import type { MarkDoseLog } from '../use_cases/mark-dose-log.js';
import type { UpdateDoseLog } from '../use_cases/update-dose-log.js';

/**
 * Application facade for the HTTP adapter.
 *
 * One method per endpoint, each delegating to exactly one use case or read model.
 * The controller therefore holds no branching and no ordering knowledge — the
 * order of side effects (write, announce, render) belongs to the use case.
 */
@Injectable()
export class MedicineDoseLogsService {
  constructor(
    private readonly logsForDate: DoseLogsForDate,
    private readonly createUseCase: CreateDoseLog,
    private readonly markUseCase: MarkDoseLog,
    private readonly updateUseCase: UpdateDoseLog,
    private readonly deleteUseCase: DeleteDoseLog,
  ) {}

  list(
    userId: string,
    date: string,
    page: number,
    pageSize: number,
  ): Promise<DoseLogListResource> {
    return this.logsForDate.get(userId, date, { page, pageSize });
  }

  create(
    userId: string,
    command: CreateDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return this.createUseCase.execute(userId, command);
  }

  mark(
    userId: string,
    command: MarkDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return this.markUseCase.execute(userId, command);
  }

  update(
    userId: string,
    id: string,
    command: UpdateDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return this.updateUseCase.execute(userId, id, command);
  }

  delete(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return this.deleteUseCase.execute(userId, id);
  }
}
