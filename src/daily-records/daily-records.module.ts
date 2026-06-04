import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordsService } from './daily-records.service';

@Module({
  imports: [PrismaModule],
  controllers: [DailyRecordsController],
  providers: [DailyRecordsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class DailyRecordsModule {}
