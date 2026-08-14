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
import { ProductEventsService } from './events.service';

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

function buildPrisma() {
  return {
    userProductEvent: {
      createMany: vi.fn().mockImplementation((args: { data: unknown[] }) => ({
        count: args.data.length,
      })),
    },
  };
}

describe('ProductEventsService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ProductEventsService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new ProductEventsService(prisma as unknown as PrismaService);
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
});
