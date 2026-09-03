import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../../common/index.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './services/files.service.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
