import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/medicine-dose-logs.service';

@Module({
  imports: [PrismaModule],
  controllers: [MedicineDoseLogsController],
  providers: [MedicineDoseLogsService],
})
export class MedicineDoseLogsModule {}
