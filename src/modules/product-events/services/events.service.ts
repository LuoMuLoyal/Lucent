import { Injectable } from '@nestjs/common';
import { badRequest, now } from '../../../common';
import { PrismaService } from '../../../prisma';
import { isKnownSuggestionRuleCode } from '../constants/rule-code-allowlist.constants';
import {
  MAX_PRODUCT_EVENT_FUTURE_SKEW_MS,
  CreateProductEventDto,
} from '../dto/create-product-event.dto';

/** Result of a batch write: events received vs rows actually inserted. */
export interface ProductEventRecordResult {
  /** Events accepted from the client (after validation). */
  received: number;
  /** Rows actually inserted — fewer when duplicate clientEventIds were skipped. */
  recorded: number;
}

/**
 * Write-only product measurement store (privacy-minimal: enums + bounded
 * attributes, no metadata JSON, no free text). No aggregation happens on the
 * request path — raw events only; aggregates are a separate task.
 *
 * Idempotency: `createMany` with `skipDuplicates` — the unique
 * (userId, clientEventId) constraint makes client retries and in-batch
 * duplicates silently skip instead of double-inserting.
 */
@Injectable()
export class ProductEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordBatch(
    userId: string,
    events: CreateProductEventDto[],
  ): Promise<ProductEventRecordResult> {
    this.assertValidEvents(events);

    const recorded = await this.prisma.userProductEvent.createMany({
      data: events.map((event) => ({
        userId,
        clientEventId: event.clientEventId,
        name: event.name,
        surface: event.surface,
        result: event.result,
        eventStatus: event.eventStatus ?? null,
        suggestionRuleCode: event.suggestionRuleCode ?? null,
        appVersion: event.appVersion,
        platform: event.platform,
        occurredAt: new Date(event.occurredAt),
      })),
      skipDuplicates: true,
    });

    return { received: events.length, recorded: recorded.count };
  }

  /**
   * Rejects the whole batch when any event fails a server-side boundary:
   * - `suggestionRuleCode` outside the server-side allowlist — no free-form
   *   strings;
   * - `occurredAt` more than `MAX_PRODUCT_EVENT_FUTURE_SKEW_MS` into the
   *   future, which would never match the 90-day retention cleanup.
   *
   * Nothing is written if any event is invalid.
   */
  private assertValidEvents(events: CreateProductEventDto[]): void {
    const futureCutoff = now().getTime() + MAX_PRODUCT_EVENT_FUTURE_SKEW_MS;
    for (const event of events) {
      if (!isKnownSuggestionRuleCode(event.suggestionRuleCode)) {
        badRequest(
          `Unknown suggestion rule code: ${String(event.suggestionRuleCode)}`,
        );
      }
      if (new Date(event.occurredAt).getTime() > futureCutoff) {
        badRequest('occurredAt must not be more than 24 hours in the future');
      }
    }
  }
}
