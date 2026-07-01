import { Injectable, Logger } from '@nestjs/common';

interface MealAnalysisJobData {
  userId: string;
  recordId: string;
  sourceRevision: number;
}

@Injectable()
export class MealAnalysisWorkerService {
  private readonly logger = new Logger(MealAnalysisWorkerService.name);

  process(job: MealAnalysisJobData): Promise<void> {
    this.logger.log(
      `Meal analysis job received: recordId=${job.recordId}, revision=${String(job.sourceRevision)}`,
    );
    return Promise.resolve();
  }
}
