import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserDevicesController } from './user-devices.controller';
import { UserDevicesService } from './services';

@Module({
  imports: [PrismaModule],
  controllers: [UserDevicesController],
  providers: [UserDevicesService],
  exports: [UserDevicesService],
})
export class UserDevicesModule {}
