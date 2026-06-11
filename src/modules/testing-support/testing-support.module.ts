import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TestingSupportController } from './testing-support.controller';
import { TestingSupportService } from './testing-support.service';

@Module({
  imports: [PrismaModule],
  controllers: [TestingSupportController],
  providers: [TestingSupportService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class TestingSupportModule {}
