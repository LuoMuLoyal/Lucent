import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client';
import { ResultCode } from '../../common';
import type { UserPayload } from '../auth';
import {
  MAX_PRODUCT_EVENTS_PER_REQUEST,
  CreateProductEventBatchDto,
  CreateProductEventDto,
} from './dto/create-product-event.dto';
import { ProductEventsController } from './product-events.controller';
import { ProductEventsService } from './services/events.service';

const user: UserPayload = {
  sub: 'user-1',
  email: 'user@example.com',
  status: 'active',
};

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

/** Mirrors the global ValidationPipe options from setup-app.ts. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe('ProductEventsController', () => {
  let controller: ProductEventsController;
  let eventsService: vi.Mocked<ProductEventsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductEventsController],
      providers: [
        {
          provide: ProductEventsService,
          useValue: { recordBatch: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get(ProductEventsController);
    eventsService = module.get(ProductEventsService);
  });

  it('records the batch for the authenticated user and returns an envelope', async () => {
    const dto = { events: [validEvent()] } as CreateProductEventBatchDto;
    eventsService.recordBatch.mockResolvedValue({ received: 1, recorded: 1 });

    const result = await controller.recordBatch(user, dto);

    expect(eventsService.recordBatch).toHaveBeenCalledWith(
      user.sub,
      dto.events,
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { received: 1, recorded: 1 },
    });
  });

  it('propagates the unknown-rule-code 400 from the service', async () => {
    eventsService.recordBatch.mockRejectedValue(
      new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'Unknown suggestion rule code: nope',
      }),
    );

    const dto = { events: [validEvent()] } as CreateProductEventBatchDto;

    await expect(controller.recordBatch(user, dto)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('propagates the future-skew 400 from the service', async () => {
    eventsService.recordBatch.mockRejectedValue(
      new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'occurredAt must not be more than 24 hours in the future',
      }),
    );

    const dto = {
      events: [validEvent({ occurredAt: '2099-01-01T00:00:00.000Z' })],
    } as CreateProductEventBatchDto;

    await expect(controller.recordBatch(user, dto)).rejects.toMatchObject({
      status: 400,
    });
    expect(eventsService.recordBatch).toHaveBeenCalledWith(
      user.sub,
      dto.events,
    );
  });

  describe('CreateProductEventBatchDto validation', () => {
    it('accepts a valid batch', async () => {
      const dto = new CreateProductEventBatchDto();
      dto.events = [Object.assign(new CreateProductEventDto(), validEvent())];

      const errors = await validate(dto, PIPE_OPTIONS);

      expect(errors).toEqual([]);
    });

    it('rejects a client-supplied userId as a non-whitelisted field', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({ userId: 'x' }),
      );

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('userId');
    });

    it('rejects any free-text metadata field', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({ metadata: { anything: true } }),
      );

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('metadata');
    });

    it('rejects an unknown event name value', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({ name: 'x' }),
      );

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('name');
    });

    it('rejects a non-ISO occurredAt', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({ occurredAt: 'yesterday-ish' }),
      );

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('occurredAt');
    });

    it('rejects an over-long appVersion', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({ appVersion: 'x'.repeat(33) }),
      );

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('appVersion');
    });

    it('rejects a missing clientEventId', async () => {
      const eventDto = Object.assign(
        new CreateProductEventDto(),
        validEvent({}),
      );
      delete (eventDto as { clientEventId?: string }).clientEventId;

      const errors = await validate(eventDto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('clientEventId');
    });

    it('rejects an empty batch', async () => {
      const dto = new CreateProductEventBatchDto();
      dto.events = [];

      const errors = await validate(dto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('events');
    });

    it(`rejects a batch above ${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events`, async () => {
      const dto = new CreateProductEventBatchDto();
      dto.events = Array.from(
        { length: MAX_PRODUCT_EVENTS_PER_REQUEST + 1 },
        (_, index) =>
          Object.assign(
            new CreateProductEventDto(),
            validEvent({ clientEventId: `c-${String(index)}` }),
          ),
      );

      const errors = await validate(dto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('events');
    });

    it(`accepts a batch of exactly ${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events`, async () => {
      const dto = new CreateProductEventBatchDto();
      dto.events = Array.from(
        { length: MAX_PRODUCT_EVENTS_PER_REQUEST },
        (_, index) =>
          Object.assign(
            new CreateProductEventDto(),
            validEvent({ clientEventId: `c-${String(index)}` }),
          ),
      );

      const errors = await validate(dto, PIPE_OPTIONS);

      expect(errors).toEqual([]);
    });
  });

  describe('batch shape', () => {
    it('treats a batch without an events array as invalid', async () => {
      const dto = new CreateProductEventBatchDto();
      dto.events = undefined as never;

      const errors = await validate(dto, PIPE_OPTIONS);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('events');
    });
  });
});
