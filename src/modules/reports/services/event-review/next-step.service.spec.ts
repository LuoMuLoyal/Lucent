import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type { EventReviewEventDto } from '../../dto/event-review-response.dto';
import {
  EventReviewNextStepService,
  type ReviewNextStepInput,
} from './next-step.service';

function eventFixture(
  overrides: Partial<EventReviewEventDto> = {},
): EventReviewEventDto {
  return {
    id: 'evt-1',
    kind: HealthEventKind.symptom,
    title: '头痛观察',
    status: HealthEventStatus.active,
    startedAt: '2026-08-01T08:00:00.000Z',
    endedAt: null,
    outcome: null,
    currentMedicineIds: ['med-1'],
    ...overrides,
  };
}

function buildService() {
  return new EventReviewNextStepService();
}

describe('EventReviewNextStepService', () => {
  it('reminds the user to confirm for an active event without a today check-in', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture(),
      hasTodayCheckIn: false,
      redFlags: [],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'active_check_in',
        arguments: { hasTodayCheckIn: false },
      },
    });
  });

  it('reports the existing today check-in for an active event', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture(),
      hasTodayCheckIn: true,
      redFlags: [],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'active_check_in',
        arguments: { hasTodayCheckIn: true },
      },
    });
  });

  it('shows the confirmed outcome for an ended event', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture({
        status: HealthEventStatus.ended,
        endedAt: '2026-08-10T20:00:00.000Z',
        outcome: HealthEventOutcome.improved,
      }),
      hasTodayCheckIn: false,
      redFlags: [],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'event_ended',
        arguments: { outcome: HealthEventOutcome.improved },
      },
    });
  });

  it('attaches reviewed static red-flag rules without free-text copy', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture(),
      hasTodayCheckIn: false,
      redFlags: [
        {
          rule: 'severeAllergy',
          medicineName: '阿司匹林',
          relatedLabel: '阿司匹林',
        },
        { rule: 'informationGap', medicineName: '手写药名' },
      ],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'active_check_in',
        arguments: {
          hasTodayCheckIn: false,
          redFlags: [
            {
              rule: 'severeAllergy',
              medicineName: '阿司匹林',
              relatedLabel: '阿司匹林',
            },
            { rule: 'informationGap', medicineName: '手写药名' },
          ],
        },
      },
    });
  });

  it('attaches red flags to the ended outcome as well', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture({
        status: HealthEventStatus.ended,
        endedAt: '2026-08-10T20:00:00.000Z',
        outcome: HealthEventOutcome.worsened,
      }),
      hasTodayCheckIn: false,
      redFlags: [{ rule: 'severeAllergy', medicineName: '阿司匹林' }],
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'event_ended',
        arguments: {
          outcome: HealthEventOutcome.worsened,
          redFlags: [{ rule: 'severeAllergy', medicineName: '阿司匹林' }],
        },
      },
    });
  });

  it('omits the redFlags key entirely when no red flags exist', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture(),
      hasTodayCheckIn: true,
      redFlags: [],
    };

    const section = service.build(input);

    expect(section.facts?.arguments).not.toHaveProperty('redFlags');
  });

  it('drops red flags whose rule is outside the reviewed allowlist', () => {
    const service = buildService();
    const input: ReviewNextStepInput = {
      event: eventFixture(),
      hasTodayCheckIn: true,
      redFlags: [
        { rule: 'severeAllergy', medicineName: '阿司匹林' },
        {
          rule: 'unreviewedRule',
          medicineName: '未知规则药',
        } as unknown as ReviewNextStepInput['redFlags'][number],
      ],
    };

    const section = service.build(input);

    expect(section.facts?.arguments).toEqual({
      hasTodayCheckIn: true,
      redFlags: [{ rule: 'severeAllergy', medicineName: '阿司匹林' }],
    });
  });
});
