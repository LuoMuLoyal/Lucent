import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { TestingSupportController } from './testing-support.controller';
import { TestingSharedSecretGuard } from './guards/testing-shared-secret.guard';
import { TestingSupportService } from './services';

@Module({
  imports: [PrismaModule],
  controllers: [TestingSupportController],
  providers: [TestingSharedSecretGuard, TestingSupportService],
})
export class TestingSupportModule {}
