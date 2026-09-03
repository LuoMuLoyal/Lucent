import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { TestingSupportController } from './testing-support.controller.js';
import { TestingSharedSecretGuard } from './guards/testing-shared-secret.guard.js';
import { TestingSupportService } from './services/fixtures.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TestingSupportController],
  providers: [TestingSharedSecretGuard, TestingSupportService],
})
export class TestingSupportModule {}
