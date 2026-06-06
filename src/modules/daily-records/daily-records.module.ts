import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DailyRecordImageUploadService } from './daily-record-image-upload.service';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsService } from './daily-records.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [DailyRecordsController],
  providers: [DailyRecordsService, DailyRecordImageUploadService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DailyRecordsModule {}
