import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../../common/storage';
import { FilesController } from './files.controller';
import { FilesService } from './services/files.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
