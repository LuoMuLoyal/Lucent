import { BadRequestException } from '@nestjs/common';
import {
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client';
import type { PrismaService } from '../../../prisma';
import { CaffeineSleepRuleService } from '../../today-suggestion/services/rules/sleep/caffeine-sleep.service';
import { MoodSleepRuleService } from '../../today-suggestion/services/rules/sleep/mood-sleep.service';
import { SleepShortfallRuleService } from '../../today-suggestion/services/rules/sleep/sleep-shortfall.service';
import { CoverageRuleService } from '../../today-suggestion/services/rules/medication/coverage.service';
import { MissedDoseRuleService } from '../../today-suggestion/services/rules/medication/missed-dose.service';
import { DeterioratingTrendRuleService } from '../../today-suggestion/services/rules/lifestyle/deteriorating-trend.service';
import { WaterShortfallRuleService } from '../../today-suggestion/services/rules/lifestyle/water-shortfall.service';
import { SUGGESTION_RULE_CODE_ALLOWLIST } from '../constants/rule-code-allowlist.constants';
import type { CreateProductEventDto } from '../dto/create-product-event.dto';
import type { MetricsService } from '../../../common/metrics/metrics.service';
import {
  ProductEventsService,
  type ServerProductEventInput,
} from './events.service';

const USER_ID = 'user-1';

function event(
  overrides: Partial<CreateProductEventDto> = {},
): CreateProductEventDto {
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

function serverEvent(
  overrides: Partial<ServerProductEventInput> = {},
): ServerProductEventInput {
  return {
    name: ProductEventName.health_event_started,
    surface: ProductEventSurface.review,
    result: ProductEventResult.success,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    userProductEvent: {
      createMany: vi.fn().mockImplementation((args: { data: unknown[] }) => ({
        count: args.data.length,
      })),
    },
  };
}

function buildMetrics() {
  return {
    recordProductEventEmissionFailure: vi.fn(),
  } as unknown as MetricsService;
}

describe('ProductEventsService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let metrics: MetricsService;
  let service: ProductEventsService;

  beforeEach(() => {
    prisma = buildPrisma();
    metrics = buildMetrics();
    service = new ProductEventsService(
      prisma as unknown as PrismaService,
      metrics,
    );
  });

  it('records a batch and returns received/recorded counts', async () => {
    prisma.userProductEvent.createMany.mockResolvedValue({ count: 2 });

    const result = await service.recordBatch(USER_ID, [
      event(),
      event({ clientEventId: 'client-2' }),
    ]);

    expect(result).toEqual({ received: 2, recorded: 2 });
  });

  it('writes only whitelisted attributes with the userId from the session', async () => {
    await service.recordBatch(USER_ID, [
      event({
        name: ProductEventName.suggestion_actioned,
        surface: ProductEventSurface.today,
        eventStatus: HealthEventStatus.active,
        suggestionRuleCode: 'water_behind_target',
        platform: UserDevicePlatform.android,
      }),
    ]);

    expect(prisma.userProductEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: USER_ID,
          clientEventId: 'client-1',
          name: ProductEventName.suggestion_actioned,
          surface: ProductEventSurface.today,
          result: ProductEventResult.success,
          eventStatus: HealthEventStatus.active,
          suggestionRuleCode: 'water_behind_target',
          appVersion: '1.2.0',
          platform: UserDevicePlatform.android,
          occurredAt: new Date('2026-08-14T02:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('stores null for omitted optional attributes', async () => {
    await service.recordBatch(USER_ID, [event()]);

    expect(prisma.userProductEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventStatus: null,
          suggestionRuleCode: null,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('is idempotent on clientEventId: retried events are skipped, not duplicated', async () => {
    prisma.userProductEvent.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.userProductEvent.createMany.mockResolvedValueOnce({ count: 0 });

    const first = await service.recordBatch(USER_ID, [event()]);
    const retry = await service.recordBatch(USER_ID, [event()]);

    expect(first.recorded).toBe(1);
    expect(retry).toEqual({ received: 1, recorded: 0 });
    expect(prisma.userProductEvent.createMany).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown suggestion rule code with a typed 400 error', async () => {
    await expect(
      service.recordBatch(USER_ID, [
        event({ suggestionRuleCode: 'free-form-code' }),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.userProductEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects unknown codes in any position of the batch before writing', async () => {
    await expect(
      service.recordBatch(USER_ID, [
        event({ clientEventId: 'ok-1' }),
        event({
          clientEventId: 'ok-2',
          suggestionRuleCode: 'water_behind_target',
        }),
        event({ clientEventId: 'bad-3', suggestionRuleCode: 'nope' }),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.userProductEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects an occurredAt more than 24h in the future (retention evasion)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    try {
      await expect(
        service.recordBatch(USER_ID, [
          event({ occurredAt: '2026-08-15T00:00:01.000Z' }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.userProductEvent.createMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts an occurredAt within the 24h future-skew window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    try {
      const result = await service.recordBatch(USER_ID, [
        event({ occurredAt: '2026-08-14T23:59:59.000Z' }),
      ]);

      expect(result.recorded).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts every rule code registered in the today-suggestion rule set', async () => {
    const result = await service.recordBatch(
      USER_ID,
      [...SUGGESTION_RULE_CODE_ALLOWLIST].map((ruleCode, index) =>
        event({
          clientEventId: `rule-${String(index)}`,
          suggestionRuleCode: ruleCode,
        }),
      ),
    );

    expect(result.recorded).toBe(SUGGESTION_RULE_CODE_ALLOWLIST.size);
    expect(prisma.userProductEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the rule-code allowlist in sync with the actual rule registry', () => {
    const registeredRuleIds = [
      new WaterShortfallRuleService().ruleId,
      new SleepShortfallRuleService().ruleId,
      new CaffeineSleepRuleService().ruleId,
      new MoodSleepRuleService().ruleId,
      new MissedDoseRuleService().ruleId,
      new CoverageRuleService().ruleId,
      new DeterioratingTrendRuleService().ruleId,
    ];

    expect([...SUGGESTION_RULE_CODE_ALLOWLIST].sort()).toEqual(
      [...registeredRuleIds].sort(),
    );
  });

  describe('recordServerEvents', () => {
    it('supplies server markers and a unique clientEventId per event', async () => {
      await service.recordServerEvents(USER_ID, [serverEvent()]);

      expect(prisma.userProductEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: USER_ID,
            name: ProductEventName.health_event_started,
            appVersion: 'server',
            platform: UserDevicePlatform.web,
            clientEventId: expect.stringMatching(/^server-[0-9a-f-]{36}$/),
            occurredAt: expect.any(Date),
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('defaults occurredAt to now when the caller omits it', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T06:00:00.000Z'));
      try {
        await service.recordServerEvents(USER_ID, [serverEvent()]);

        const data = (
          prisma.userProductEvent.createMany.mock.calls[0]![0] as {
            data: { occurredAt: Date }[];
          }
        ).data;
        expect(data[0]!.occurredAt).toEqual(
          new Date('2026-08-14T06:00:00.000Z'),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('honors an explicit occurredAt and passes optional attributes through', async () => {
      await service.recordServerEvents(USER_ID, [
        serverEvent({
          name: ProductEventName.health_event_ended,
          result: ProductEventResult.improved,
          eventStatus: HealthEventStatus.ended,
          suggestionRuleCode: 'water_behind_target',
          occurredAt: new Date('2026-08-14T08:30:00.000Z'),
        }),
      ]);

      const data = (
        prisma.userProductEvent.createMany.mock.calls[0]![0] as {
          data: Record<string, unknown>[];
        }
      ).data;
      expect(data[0]).toMatchObject({
        result: ProductEventResult.improved,
        eventStatus: HealthEventStatus.ended,
        suggestionRuleCode: 'water_behind_target',
      });
      expect(data[0]!['occurredAt']).toEqual(
        new Date('2026-08-14T08:30:00.000Z'),
      );
    });

    it('rejects a non-allowlisted suggestion rule code before writing', async () => {
      await expect(
        service.recordServerEvents(USER_ID, [
          serverEvent({ suggestionRuleCode: 'free-form-code' }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.userProductEvent.createMany).not.toHaveBeenCalled();
    });

    it('generates distinct clientEventIds so retried emissions never collide', async () => {
      await service.recordServerEvents(USER_ID, [serverEvent()]);
      await service.recordServerEvents(USER_ID, [serverEvent()]);

      const calls = prisma.userProductEvent.createMany.mock.calls as {
        data: { clientEventId: string }[];
      }[][];
      const first = calls[0]![0]!.data[0]!.clientEventId;
      const second = calls[1]![0]!.data[0]!.clientEventId;
      expect(first).not.toBe(second);
    });
  });

  describe('emitServerEvent', () => {
    it('records the event after a successful write', async () => {
      await service.emitServerEvent(USER_ID, serverEvent());

      expect(prisma.userProductEvent.createMany).toHaveBeenCalledTimes(1);
      expect(metrics.recordProductEventEmissionFailure).not.toHaveBeenCalled();
    });

    it('never throws on a failed write, logs low-sensitivity error and bumps the metric', async () => {
      const loggerSpy = vi
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      prisma.userProductEvent.createMany.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.emitServerEvent(USER_ID, serverEvent()),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Product event emission failed (health_event_started)',
        ),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.not.stringContaining(USER_ID),
      );
      expect(metrics.recordProductEventEmissionFailure).toHaveBeenCalledWith(
        ProductEventName.health_event_started,
      );
      loggerSpy.mockRestore();
    });

    it('does not fail the caller when the emission write is rejected', async () => {
      prisma.userProductEvent.createMany.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.emitServerEvent(USER_ID, serverEvent()),
      ).resolves.toBeUndefined();
    });
  });
});
