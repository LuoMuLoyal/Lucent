import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';

/**
 * Process-wide Postgres checkpoint provider for the assistant graph.
 *
 * Backed by `DATABASE_URL` (same pg Pool pattern as the vector store factory).
 * When the URL is missing or initialization fails the service returns `null`
 * from {@link getSaver}, letting callers degrade to the old stateless
 * behavior instead of breaking the assistant.
 *
 * ## Why the checkpoint tables get their own schema
 *
 * `PostgresSaver.setup()` creates and migrates its own tables at startup. Left
 * on the default `public` schema, those four tables (`checkpoints`,
 * `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`) become the
 * one place where table structure is not owned by `prisma/models/**` — a fact
 * that is invisible in the Prisma schema and in migration reviews, and that
 * `docs/reference/database-conventions.md` forbids for every other table.
 *
 * The package takes a `schema` option and emits `CREATE SCHEMA IF NOT EXISTS`
 * in `setup()`, so the isolation costs one constructor argument and no manual
 * DDL. Keep `LANGGRAPH_CHECKPOINTER_SCHEMA` distinct from `public`.
 */
@Injectable()
export class AssistantCheckpointerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantCheckpointerService.name);
  private saver: BaseCheckpointSaver | null = null;
  private pool: Pool | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const databaseUrl = this.configService.get<string>(EnvKey.DATABASE_URL);
    if (databaseUrl == null || databaseUrl.length === 0) {
      this.logger.warn(
        'DATABASE_URL missing; assistant checkpoint persistence disabled',
      );
      return;
    }
    try {
      this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
      const schema =
        this.configService.get<string>(EnvKey.LANGGRAPH_CHECKPOINTER_SCHEMA) ??
        'langgraph';
      const postgresSaver = new PostgresSaver(this.pool, undefined, { schema });
      await postgresSaver.setup(); // idempotent: creates the schema, tables and runs migrations
      this.saver = postgresSaver;
      this.logger.log(
        `Assistant checkpoint persistence ready (schema=${schema})`,
      );
    } catch (error) {
      this.logger.error(
        `Checkpoint init failed; falling back: ${String(error)}`,
      );
      await this.pool?.end();
      this.pool = null;
      this.saver = null;
    }
  }

  getSaver(): BaseCheckpointSaver | null {
    return this.saver;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
