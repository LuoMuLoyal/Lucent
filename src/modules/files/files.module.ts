import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../../common/index.js';
import { FilesController } from './adapters/http/files.controller.js';
import { FilesService } from './application/use_cases/create-upload.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
