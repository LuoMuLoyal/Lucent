import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsComputationService } from './reports-computation.service';
import { ReportsContextService } from './reports-context.service';
import { ReportsPresenterService } from './reports-presenter.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsComputationService,
    ReportsContextService,
    ReportsPresenterService,
    ReportsService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class ReportsModule {}
