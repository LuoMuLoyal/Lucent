import { Test, type TestingModule } from '@nestjs/testing';
import { errAsync, okAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';

import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './services/notifications.service.js';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

const mockItem = {
  id: 'notif-uuid-1',
  type: 'medicine_missed_dose' as const,
  title: 'Missed dose reminder',
  content: 'You missed your evening dose of Ibuprofen.',
  action: '/record/dose-log',
  actionPayload: { medicineId: 'med-1' },
  isRead: false,
  createdAt: '2026-06-10T08:00:00.000Z',
};

const mockDetail = {
  ...mockItem,
  readAt: null,
};

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: vi.Mocked<NotificationsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            markAsRead: vi.fn(),
            markAsUnread: vi.fn(),
            markAllAsRead: vi.fn(),
            remove: vi.fn(),
            getUnreadCount: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(NotificationsController);
    service = module.get(NotificationsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /user/notifications', () => {
    it('should create a notification and return a resource', async () => {
      service.create.mockReturnValue(okAsync(mockItem));

      const result = await controller.create(mockUser, {
        type: 'medicine_missed_dose',
        title: 'Missed dose reminder',
        content: 'You missed your evening dose of Ibuprofen.',
      });

      expect(service.create).toHaveBeenCalledWith(mockUser.sub, {
        type: 'medicine_missed_dose',
        title: 'Missed dose reminder',
        content: 'You missed your evening dose of Ibuprofen.',
      });
      expect(result).toEqual(mockItem);
    });

    it('folds a service Err into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'conflict',
        code: 'RESOURCE_CONFLICT',
      };
      service.create.mockReturnValue(errAsync(failure));

      await expect(
        controller.create(mockUser, {
          type: 'medicine_missed_dose',
          title: 'Missed dose reminder',
          content: 'Content',
        }),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });
  });

  describe('GET /user/notifications', () => {
    it('should return a paginated list resource with defaults', async () => {
      service.findAll.mockResolvedValue({ items: [mockItem], total: 1 });

      const result = await controller.findAll(mockUser);

      expect(service.findAll).toHaveBeenCalledWith(mockUser.sub, {
        page: 1,
        pageSize: 20,
      });
      expect(result).toEqual({ items: [mockItem], total: 1 });
    });

    it('should pass page and pageSize query parameters', async () => {
      service.findAll.mockResolvedValue({ items: [], total: 0 });

      await controller.findAll(mockUser, 2, 10);

      expect(service.findAll).toHaveBeenCalledWith(mockUser.sub, {
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('GET /user/notifications/unread-count', () => {
    it('should return unread count resource', async () => {
      service.getUnreadCount.mockResolvedValue(3);

      const result = await controller.getUnreadCount(mockUser);

      expect(service.getUnreadCount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('GET /user/notifications/:id', () => {
    it('should return notification detail resource', async () => {
      service.findOne.mockReturnValue(okAsync(mockDetail));

      const result = await controller.findOne(mockUser, 'notif-uuid-1');

      expect(service.findOne).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual(mockDetail);
    });

    it('folds NOTIFICATION_NOT_FOUND into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'NOTIFICATION_NOT_FOUND',
      };
      service.findOne.mockReturnValue(errAsync(failure));

      await expect(
        controller.findOne(mockUser, 'nonexistent'),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'NOTIFICATION_NOT_FOUND' }),
      });
    });
  });

  describe('PATCH /user/notifications/:id/read', () => {
    it('should mark as read and return a resource', async () => {
      service.markAsRead.mockReturnValue(okAsync(mockDetail));

      const result = await controller.markAsRead(mockUser, 'notif-uuid-1');

      expect(service.markAsRead).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual(mockDetail);
    });

    it('folds NOTIFICATION_NOT_FOUND into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'NOTIFICATION_NOT_FOUND',
      };
      service.markAsRead.mockReturnValue(errAsync(failure));

      await expect(
        controller.markAsRead(mockUser, 'nonexistent'),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'NOTIFICATION_NOT_FOUND' }),
      });
    });
  });

  describe('PATCH /user/notifications/:id/unread', () => {
    it('should mark as unread and return a resource', async () => {
      service.markAsUnread.mockReturnValue(okAsync(mockDetail));

      const result = await controller.markAsUnread(mockUser, 'notif-uuid-1');

      expect(service.markAsUnread).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual(mockDetail);
    });

    it('folds NOTIFICATION_NOT_FOUND into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'NOTIFICATION_NOT_FOUND',
      };
      service.markAsUnread.mockReturnValue(errAsync(failure));

      await expect(
        controller.markAsUnread(mockUser, 'nonexistent'),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'NOTIFICATION_NOT_FOUND' }),
      });
    });
  });

  describe('PATCH /user/notifications/mark-all-read', () => {
    it('should mark all as read and return count resource', async () => {
      service.markAllAsRead.mockResolvedValue(5);

      const result = await controller.markAllAsRead(mockUser);

      expect(service.markAllAsRead).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({ count: 5 });
    });
  });

  describe('DELETE /user/notifications/:id', () => {
    it('should delete notification', async () => {
      service.remove.mockReturnValue(okAsync(undefined));

      await controller.remove(mockUser, 'notif-uuid-1');

      expect(service.remove).toHaveBeenCalledWith(mockUser.sub, 'notif-uuid-1');
    });

    it('folds NOTIFICATION_NOT_FOUND into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'NOTIFICATION_NOT_FOUND',
      };
      service.remove.mockReturnValue(errAsync(failure));

      await expect(
        controller.remove(mockUser, 'nonexistent'),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'NOTIFICATION_NOT_FOUND' }),
      });
    });
  });
});
