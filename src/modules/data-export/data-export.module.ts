import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';

@Module({
  imports: [AuthModule],
  controllers: [DataExportController],
  providers: [DataExportService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DataExportModule {}
