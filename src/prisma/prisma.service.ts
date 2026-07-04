import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#generated/prisma/client';
import { EnvKey } from '../config/env-keys.enum.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>(EnvKey.DATABASE_URL);
    if (connectionString === undefined) {
      throw new Error(
        `Missing required environment variable: ${EnvKey.DATABASE_URL}`,
      );
    }
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    if (process.env[EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT] === 'true') {
      return;
    }
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
