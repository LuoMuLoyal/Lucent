/**
 * Lucent → Mem0 sidecar 的 HTTP 客户端（长期记忆，计划 Phase 5）。
 *
 * ## 形态与 LightRAG client 同构
 *
 * 只做三件事：解析配置、发请求、把上游形态归一成端口类型。记忆的语义
 * （什么时候写入、怎么拼记忆块、注入多少条）都在服务层（`memory.ts`），
 * 不在这里——客户端保持纯粹，换 sidecar 时只动这一层。
 *
 * ## 失败语义
 *
 * 失败一律返回判别式结果而不是抛异常：调用方必须能把「记忆服务不可用」
 * 与「确实没有记忆」区分开，异常会诱使调用方用一个 catch 把两者合成
 * "没有记忆"——那是静默降级，不是降级。
 *
 * ## 上游契约（实读 mem0 REST API 文档，非推测）
 *
 * - `POST /memories`：`{ messages: [{role, content}], user_id }`，服务端自己
 *   做事实抽取与去重（这正是选它而不是自研的核心理由——WeKnora §7.3 的
 *   `normalized_key` supersede 语义由它承担）。
 * - `POST /search`：`{ query, user_id }`，返回 `results[]`（含 `memory` 与
 *   `score`）。
 * - `DELETE /memories`：按 identifier 级联清空（隐私擦除入口）。
 * - 鉴权：`X-API-Key`（legacy `ADMIN_API_KEY` 模式），**不是** Bearer。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import {
  MEM0_DEFAULT_BASE_URL,
  MEM0_DEFAULT_TIMEOUT_MS,
} from '../../../../config/env/sidecar-defaults.js';

/** One conversation turn handed to Mem0 for fact extraction. */
export interface Mem0TurnMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** One recalled memory with its relevance score. */
export interface Mem0MemoryHit {
  readonly id: string;
  readonly memory: string;
  readonly score: number;
}

/** Discriminated outcome for a Mem0 write (fact extraction). */
export type Mem0AddResult =
  | { readonly ok: true; readonly added: number }
  | { readonly ok: false; readonly reason: string };

/** Discriminated outcome for a Mem0 read. */
export type Mem0SearchResult =
  | { readonly ok: true; readonly hits: readonly Mem0MemoryHit[] }
  | { readonly ok: false; readonly reason: string };

/** Discriminated outcome for the privacy erase. */
export type Mem0DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolved per call from the runtime snapshot, so an operator can flip the
 * sidecar off, move it, or widen the timeout without a restart.
 */
interface Mem0Settings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

const AUTH_HEADER_NAME = 'X-API-Key';

/** Logged once instead of once per call when the flag is on but the key is not. */
const MAX_ERROR_BODY_LOG_CHARS = 300;

@Injectable()
export class Mem0ClientService {
  private readonly logger = new Logger(Mem0ClientService.name);

  /**
   * Secret, read from the environment only: an API key is not a tunable, so it
   * never enters the runtime snapshot (same rule as LIGHTRAG_API_KEY).
   */
  private readonly apiKey: string | null;
  private readonly configService: ConfigService;
  private readonly runtimeConfig: RuntimeConfigPort | undefined;
  /** Logged once instead of once per call when the flag is on but the key is not. */
  private warnedMissingKey = false;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    runtimeConfig?: RuntimeConfigPort,
  ) {
    this.configService = configService;
    this.runtimeConfig = runtimeConfig;
    const apiKey =
      this.configService.get<string>(EnvKey.MEM0_API_KEY)?.trim() ?? '';
    this.apiKey = apiKey.length > 0 ? apiKey : null;
  }

  /** Current sidecar settings. Read per call, never cached in a field. */
  private readSettings(): Mem0Settings {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      enabled:
        values?.[EnvKey.MEM0_ENABLED] ??
        this.configService.get<string>(EnvKey.MEM0_ENABLED) === 'true',
      baseUrl: (
        values?.[EnvKey.MEM0_BASE_URL] ??
        this.configService.get<string>(EnvKey.MEM0_BASE_URL) ??
        MEM0_DEFAULT_BASE_URL
      ).replace(/\/+$/, ''),
      timeoutMs:
        values?.[EnvKey.MEM0_TIMEOUT_MS] ??
        this.configService.get<number>(EnvKey.MEM0_TIMEOUT_MS) ??
        MEM0_DEFAULT_TIMEOUT_MS,
    };
  }

  /** sidecar 是否已启用且具备鉴权条件。 */
  isEnabled(): boolean {
    if (!this.readSettings().enabled) return false;
    if (this.apiKey == null) {
      if (!this.warnedMissingKey) {
        this.warnedMissingKey = true;
        this.logger.warn(
          `${EnvKey.MEM0_ENABLED} is on but ${EnvKey.MEM0_API_KEY} is unset; memory calls degrade to "not configured".`,
        );
      }
      return false;
    }
    return true;
  }

  /**
   * 把一轮对话交给 Mem0 做事实抽取与去重。
   * 写路径在 archive 流程上，失败只记日志（调用方已按 best-effort 处理）。
   */
  async addMemories(
    userId: string,
    messages: readonly Mem0TurnMessage[],
  ): Promise<Mem0AddResult> {
    const outcome = await this.request('POST', '/memories', {
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      user_id: userId,
    });
    if (!outcome.ok) return outcome;
    // Mem0 returns the affected memory records; an empty array means the
    // extraction decided nothing durable was said — a normal, ok outcome.
    const body = outcome.body;
    const records = Array.isArray(body)
      ? body
      : Array.isArray((body as { results?: unknown[] } | null)?.results)
        ? ((body as { results: unknown[] }).results as unknown[])
        : [];
    return { ok: true, added: records.length };
  }

  /**
   * 按查询召回该用户的记忆。注入预算（条数截断）在服务层，不在客户端。
   */
  async searchMemories(
    userId: string,
    query: string,
  ): Promise<Mem0SearchResult> {
    const outcome = await this.request('POST', '/search', {
      query,
      user_id: userId,
    });
    if (!outcome.ok) return outcome;
    const body = outcome.body;
    const raw = Array.isArray((body as { results?: unknown[] } | null)?.results)
      ? ((body as { results: unknown[] }).results as unknown[])
      : [];
    const hits: Mem0MemoryHit[] = [];
    for (const item of raw) {
      if (item == null || typeof item !== 'object') continue;
      const record = item as { memory?: unknown; score?: unknown; id?: unknown };
      if (typeof record.memory !== 'string') continue;
      hits.push({
        id: typeof record.id === 'string' ? record.id : '',
        memory: record.memory,
        score: typeof record.score === 'number' ? record.score : 0,
      });
    }
    return { ok: true, hits };
  }

  /**
   * 隐私擦除入口：清空该用户全部记忆（设置页的「清除记忆」按钮）。
   */
  async deleteAllForUser(userId: string): Promise<Mem0DeleteResult> {
    const outcome = await this.request('DELETE', '/memories', {
      user_id: userId,
    });
    return outcome.ok ? { ok: true } : outcome;
  }

  /**
   * 发一个带鉴权与超时的请求，把上游形态归一成统一信封。
   * 网络错误、非 2xx、超时统一为 `{ ok: false, reason }`，不抛异常——
   * 调用方（memory 服务）据此区分「sidecar 不可用」与「没有记忆」。
   */
  private async request(
    method: 'POST' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
    const settings = this.readSettings();
    if (!settings.enabled) {
      return { ok: false, reason: 'not_configured' };
    }
    if (this.apiKey == null) {
      return { ok: false, reason: 'missing_api_key' };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      settings.timeoutMs,
    );
    timer.unref();

    try {
      const response = await fetch(`${settings.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          [AUTH_HEADER_NAME]: this.apiKey,
        },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // 错误 body 只截前 300 字符进日志：日志要的是线索，不是整段 HTML。
        const raw = await response.text().catch(() => '');
        const detail =
          raw.length > MAX_ERROR_BODY_LOG_CHARS
            ? `${raw.slice(0, MAX_ERROR_BODY_LOG_CHARS)}…`
            : raw;
        this.logger.warn(
          `Mem0 ${method} ${path} -> ${String(response.status)}: ${detail}`,
        );
        return { ok: false, reason: `http_${String(response.status)}` };
      }
      const bodyJson: unknown = await response.json().catch(() => null);
      return { ok: true, body: bodyJson };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Mem0 ${method} ${path} failed: ${message}`);
      return { ok: false, reason: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
