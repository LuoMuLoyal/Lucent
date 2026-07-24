import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { UserDevicesController } from './user-devices.controller';
import { UserDevicesService } from './services/user-devices.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserDevicesController],
  providers: [UserDevicesService],
  exports: [UserDevicesService],
})
export class UserDevicesModule {}
