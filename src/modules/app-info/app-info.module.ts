import { Module } from '@nestjs/common';
import { AppInfoController } from './app-info.controller.js';
import { AppInfoService } from './services/info.service.js';

@Module({
  controllers: [AppInfoController],
  providers: [AppInfoService],
})
export class AppInfoModule {}
