/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DailyRecordImageUploadRuntime } from '../daily-records/config/daily-record-image-upload.runtime';
import { FilesController } from './files.controller';
import { FilesService } from './services/files.service';

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [DailyRecordImageUploadRuntime, FilesService],
})
export class FilesModule {}
