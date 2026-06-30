import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import type { UserPayload } from '../auth/services/auth-token.service';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './services/notifications.service';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
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
  let service: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            markAsRead: jest.fn(),
            markAsUnread: jest.fn(),
            markAllAsRead: jest.fn(),
            remove: jest.fn(),
            getUnreadCount: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(NotificationsController);
    service = module.get(NotificationsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /user/notifications', () => {
    it('should create a notification and return 201 envelope', async () => {
      service.create.mockResolvedValue(mockItem);

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
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockItem,
      });
    });
  });

  describe('GET /user/notifications', () => {
    it('should return paginated list envelope with defaults', async () => {
      service.findAll.mockResolvedValue({ items: [mockItem], total: 1 });

      const result = await controller.findAll(mockUser);

      expect(service.findAll).toHaveBeenCalledWith(mockUser.sub, {
        page: 1,
        pageSize: 20,
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { items: [mockItem], total: 1 },
      });
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
    it('should return unread count envelope', async () => {
      service.getUnreadCount.mockResolvedValue(3);

      const result = await controller.getUnreadCount(mockUser);

      expect(service.getUnreadCount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { count: 3 },
      });
    });
  });

  describe('GET /user/notifications/:id', () => {
    it('should return notification detail envelope', async () => {
      service.findOne.mockResolvedValue(mockDetail);

      const result = await controller.findOne(mockUser, 'notif-uuid-1');

      expect(service.findOne).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockDetail,
      });
    });

    it('should return null data when notification not found', async () => {
      service.findOne.mockResolvedValue(null);

      const result = await controller.findOne(mockUser, 'nonexistent');

      expect(result.data).toBeNull();
    });
  });

  describe('PATCH /user/notifications/:id/read', () => {
    it('should mark as read and return envelope', async () => {
      service.markAsRead.mockResolvedValue(mockDetail);

      const result = await controller.markAsRead(mockUser, 'notif-uuid-1');

      expect(service.markAsRead).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockDetail,
      });
    });
  });

  describe('PATCH /user/notifications/:id/unread', () => {
    it('should mark as unread and return envelope', async () => {
      service.markAsUnread.mockResolvedValue(mockDetail);

      const result = await controller.markAsUnread(mockUser, 'notif-uuid-1');

      expect(service.markAsUnread).toHaveBeenCalledWith(
        mockUser.sub,
        'notif-uuid-1',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockDetail,
      });
    });
  });

  describe('PATCH /user/notifications/mark-all-read', () => {
    it('should mark all as read and return count envelope', async () => {
      service.markAllAsRead.mockResolvedValue(5);

      const result = await controller.markAllAsRead(mockUser);

      expect(service.markAllAsRead).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { count: 5 },
      });
    });
  });

  describe('DELETE /user/notifications/:id', () => {
    it('should delete notification', async () => {
      service.remove.mockResolvedValue(true);

      await controller.remove(mockUser, 'notif-uuid-1');

      expect(service.remove).toHaveBeenCalledWith(mockUser.sub, 'notif-uuid-1');
    });
  });
});
