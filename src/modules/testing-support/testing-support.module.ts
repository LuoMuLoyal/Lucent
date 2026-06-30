import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TestingSupportController } from './testing-support.controller';
import { TestingSupportService } from './services/testing-support.service';

@Module({
  imports: [PrismaModule],
  controllers: [TestingSupportController],
  providers: [TestingSupportService],
})
export class TestingSupportModule {}
