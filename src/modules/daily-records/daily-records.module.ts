import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DailyRecordsGuardService } from './daily-records-guard.service';
import { DailyRecordImageUploadService } from './daily-record-image-upload.service';
import { DailyRecordImageUploadRuntime } from './daily-record-image-upload.runtime';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsMapperService } from './daily-records-mapper.service';
import { DailyRecordsService } from './daily-records.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [DailyRecordsController],
  providers: [
    DailyRecordsGuardService,
    DailyRecordsService,
    DailyRecordsMapperService,
    DailyRecordImageUploadRuntime,
    DailyRecordImageUploadService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DailyRecordsModule {}
