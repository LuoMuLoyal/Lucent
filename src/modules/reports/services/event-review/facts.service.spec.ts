import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type { EventReviewEventDto } from '../../dto/event-review-response.dto';
import {
  EventReviewFactsService,
  type ReviewEventFactInput,
} from './facts.service';

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
    currentMedicineIds: ['med-1', 'med-2'],
    ...overrides,
  };
}

function buildService() {
  return new EventReviewFactsService();
}

describe('EventReviewFactsService', () => {
  it('reports the event window, user title, linked medicines and observed counts', () => {
    const service = buildService();
    const input: ReviewEventFactInput = {
      event: eventFixture(),
      symptomRecordCount: 3,
      checkInCount: 5,
      reasonRecordTitle: null,
    };

    expect(service.build(input)).toEqual({
      state: 'available',
      facts: {
        code: 'health_event',
        arguments: {
          kind: HealthEventKind.symptom,
          title: '头痛观察',
          startedAt: '2026-08-01T08:00:00.000Z',
          endedAt: null,
          medicineIds: ['med-1', 'med-2'],
          symptomRecordCount: 3,
          checkInCount: 5,
          reasonRecordTitle: null,
        },
      },
    });
  });

  it('reports the confirmed outcome window for an ended event', () => {
    const service = buildService();
    const input: ReviewEventFactInput = {
      event: eventFixture({
        status: HealthEventStatus.ended,
        endedAt: '2026-08-10T20:00:00.000Z',
        outcome: HealthEventOutcome.improved,
      }),
      symptomRecordCount: 1,
      checkInCount: 2,
      reasonRecordTitle: null,
    };

    expect(service.build(input).facts?.arguments).toEqual({
      kind: HealthEventKind.symptom,
      title: '头痛观察',
      startedAt: '2026-08-01T08:00:00.000Z',
      endedAt: '2026-08-10T20:00:00.000Z',
      medicineIds: ['med-1', 'med-2'],
      symptomRecordCount: 1,
      checkInCount: 2,
      reasonRecordTitle: null,
    });
  });

  it('never emits free-text notes in the facts arguments', () => {
    const service = buildService();
    const input: ReviewEventFactInput = {
      event: eventFixture(),
      symptomRecordCount: 0,
      checkInCount: 0,
      reasonRecordTitle: null,
    };

    const section = service.build(input);

    expect(section.facts?.arguments).not.toHaveProperty('note');
    expect(section.facts?.arguments).not.toHaveProperty('summary');
    expect(section.facts?.arguments).not.toHaveProperty('text');
  });

  it('copies the medicine id list instead of sharing the event array', () => {
    const service = buildService();
    const event = eventFixture();
    const input: ReviewEventFactInput = {
      event,
      symptomRecordCount: 0,
      checkInCount: 0,
      reasonRecordTitle: null,
    };

    const section = service.build(input);
    event.currentMedicineIds.push('med-3');

    expect(section.facts?.arguments['medicineIds']).toEqual(['med-1', 'med-2']);
  });

  it('always emits the reasonRecordTitle argument, null or title', () => {
    const service = buildService();

    expect(
      service.build({
        event: eventFixture(),
        symptomRecordCount: 0,
        checkInCount: 0,
        reasonRecordTitle: null,
      }).facts?.arguments['reasonRecordTitle'],
    ).toBeNull();
    expect(
      service.build({
        event: eventFixture(),
        symptomRecordCount: 0,
        checkInCount: 0,
        reasonRecordTitle: '头晕',
      }).facts?.arguments['reasonRecordTitle'],
    ).toBe('头晕');
  });
});
