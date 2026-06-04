import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './medicine-dose-logs.service';

@Module({
  imports: [PrismaModule],
  controllers: [MedicineDoseLogsController],
  providers: [MedicineDoseLogsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class MedicineDoseLogsModule {}
