import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client.js';
import { errAsync, okAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import {
  MAX_PRODUCT_EVENTS_PER_REQUEST,
  createProductEventBatchSchema,
  createProductEventSchema,
} from './dto/create-product-event.dto.js';
import type { CreateProductEventBatchDto } from './dto/create-product-event.dto.js';
import { productFunnelQuerySchema } from './dto/funnel-query.dto.js';
import type { FunnelQueryDto } from './dto/funnel-query.dto.js';
import { ProductEventsController } from './product-events.controller.js';
import { ProductEventsService } from './services/events.service.js';
import { ProductFunnelService } from './services/funnel.service.js';

const user: UserPayload = {
  sub: 'user-1',
  email: 'user@example.com',
  status: 'active',
};

function validationFailure(): DomainFailure {
  return {
    _tag: 'DomainFailure',
    kind: 'validation',
    code: 'VALIDATION_FAILED',
  };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: ProductEventName.review_opened,
    surface: ProductEventSurface.review,
    result: ProductEventResult.success,
    appVersion: '1.2.0',
    platform: UserDevicePlatform.ios,
    occurredAt: '2026-08-14T02:00:00.000Z',
    clientEventId: 'client-1',
    ...overrides,
  };
}

/** JSON of the zod issues — asserted to contain the offending property name. */
function issuesJson(result: {
  success: boolean;
  error?: { issues?: unknown[] };
}): string {
  return result.success ? '' : JSON.stringify(result.error?.issues ?? []);
}

describe('ProductEventsController', () => {
  let controller: ProductEventsController;
  let eventsService: vi.Mocked<ProductEventsService>;
  let funnelService: vi.Mocked<ProductFunnelService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductEventsController],
      providers: [
        {
          provide: ProductEventsService,
          useValue: { recordBatch: vi.fn() },
        },
        {
          provide: ProductFunnelService,
          useValue: { getFunnel: vi.fn() },
        },
        // The controller's @UseGuards(AdminGuard) is instantiated by the
        // testing module; AdminGuard needs ConfigService to resolve.
        {
          provide: ConfigService,
          useValue: { get: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get(ProductEventsController);
    eventsService = module.get(ProductEventsService);
    funnelService = module.get(ProductFunnelService);
  });

  it('records the batch for the authenticated user and returns the resource', async () => {
    const dto = { events: [validEvent()] } as CreateProductEventBatchDto;
    eventsService.recordBatch.mockReturnValue(
      okAsync({ received: 1, recorded: 1 }),
    );

    const result = await controller.recordBatch(user, dto);

    expect(eventsService.recordBatch).toHaveBeenCalledWith(
      user.sub,
      dto.events,
    );
    expect(result).toEqual({ received: 1, recorded: 1 });
  });

  it('folds the unknown-rule-code 400 from the service', async () => {
    eventsService.recordBatch.mockReturnValue(errAsync(validationFailure()));

    const dto = { events: [validEvent()] } as CreateProductEventBatchDto;

    await expect(controller.recordBatch(user, dto)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    });
  });

  it('folds the future-skew 400 from the service', async () => {
    eventsService.recordBatch.mockReturnValue(errAsync(validationFailure()));

    const dto = {
      events: [validEvent({ occurredAt: '2099-01-01T00:00:00.000Z' })],
    } as CreateProductEventBatchDto;

    await expect(controller.recordBatch(user, dto)).rejects.toMatchObject({
      name: 'DomainFailureException',
    });
    expect(eventsService.recordBatch).toHaveBeenCalledWith(
      user.sub,
      dto.events,
    );
  });

  describe('createProductEventSchema (one event)', () => {
    it('accepts a valid event', () => {
      const result = createProductEventSchema.safeParse(validEvent());

      expect(result.success).toBe(true);
    });

    it('rejects a client-supplied userId as an unknown field', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ userId: 'x' }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('userId');
    });

    it('rejects any free-text metadata field', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ metadata: { anything: true } }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('metadata');
    });

    it('rejects an unknown event name value', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ name: 'x' }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('name');
    });

    it('rejects a non-ISO occurredAt', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ occurredAt: 'yesterday-ish' }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('occurredAt');
    });

    it('rejects a datetime without a UTC offset', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ occurredAt: '2026-08-14T02:00:00' }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('occurredAt');
    });

    it('rejects an over-long appVersion', () => {
      const result = createProductEventSchema.safeParse(
        validEvent({ appVersion: 'x'.repeat(33) }),
      );

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('appVersion');
    });

    it('rejects a missing clientEventId', () => {
      const event = validEvent();
      delete (event as { clientEventId?: string }).clientEventId;

      const result = createProductEventSchema.safeParse(event);

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('clientEventId');
    });
  });

  describe('createProductEventBatchSchema', () => {
    it('accepts a valid batch', () => {
      const result = createProductEventBatchSchema.safeParse({
        events: [validEvent()],
      });

      expect(result.success).toBe(true);
    });

    it('rejects an empty batch', () => {
      const result = createProductEventBatchSchema.safeParse({ events: [] });

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('events');
    });

    it(`rejects a batch above ${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events`, () => {
      const result = createProductEventBatchSchema.safeParse({
        events: Array.from(
          { length: MAX_PRODUCT_EVENTS_PER_REQUEST + 1 },
          (_, index) => validEvent({ clientEventId: `c-${String(index)}` }),
        ),
      });

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('events');
    });

    it(`accepts a batch of exactly ${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events`, () => {
      const result = createProductEventBatchSchema.safeParse({
        events: Array.from(
          { length: MAX_PRODUCT_EVENTS_PER_REQUEST },
          (_, index) => validEvent({ clientEventId: `c-${String(index)}` }),
        ),
      });

      expect(result.success).toBe(true);
    });

    it('treats a batch without an events array as invalid', () => {
      const result = createProductEventBatchSchema.safeParse({});

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('events');
    });

    it('rejects an unknown top-level body key', () => {
      const result = createProductEventBatchSchema.safeParse({
        events: [validEvent()],
        userId: 'attacker-id',
      });

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('userId');
    });
  });

  describe('funnel aggregation', () => {
    const funnelResult = {
      daily: [],
      optional: {
        visitSummaryPreviewed: 0,
        visitSummaryExported: 0,
        visitSummaryShareCreated: 0,
        visitSummaryShareOpened: 0,
      },
      totals: {
        eventStarted: 0,
        suggestionImpression: 0,
        suggestionActioned: 0,
        eventEndedOrOutcome: 0,
        reviewOpened: 0,
      },
      window: {
        dateFrom: '2026-07-16',
        dateTo: '2026-08-14',
        generatedAt: '2026-08-14T02:00:00.000Z',
        detailsSuppressed: true,
      },
    };

    it('forwards the query params and returns the funnel resource', async () => {
      funnelService.getFunnel.mockReturnValue(okAsync(funnelResult));

      const query: FunnelQueryDto = {
        dateFrom: '2026-07-16',
        dateTo: '2026-08-14',
      };
      const result = await controller.getFunnel(query);

      expect(funnelService.getFunnel).toHaveBeenCalledWith(query);
      expect(result).toEqual(funnelResult);
    });

    it('folds the date-range-cap 400 from the service', async () => {
      funnelService.getFunnel.mockReturnValue(errAsync(validationFailure()));

      await expect(
        controller.getFunnel({ dateFrom: '2026-08-14', dateTo: '2026-09-13' }),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
    });
  });

  describe('productFunnelQuerySchema', () => {
    it('accepts date-only params', () => {
      const result = productFunnelQuerySchema.safeParse({
        dateFrom: '2026-07-16',
        dateTo: '2026-08-14',
      });

      expect(result.success).toBe(true);
    });

    it('accepts full ISO datetimes with a UTC offset and an empty query', () => {
      expect(
        productFunnelQuerySchema.safeParse({
          dateFrom: '2026-07-16T10:00:00.000Z',
          dateTo: '2026-08-14T10:00:00.000Z',
        }).success,
      ).toBe(true);
      expect(productFunnelQuerySchema.safeParse({}).success).toBe(true);
    });

    it('rejects a non-ISO date string', () => {
      const result = productFunnelQuerySchema.safeParse({
        dateFrom: 'yesterday',
        dateTo: '2026-08-14',
      });

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('dateFrom');
    });

    it('rejects non-whitelisted query params', () => {
      const result = productFunnelQuerySchema.safeParse({
        dateFrom: '2026-08-14',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(issuesJson(result)).toContain('userId');
    });
  });
});
