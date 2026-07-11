import type { DeepMocked } from '../../common/types/deep-mocked';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { NotificationsService } from './services/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockNotificationRow = {
  id: 'notif-uuid-1',
  type: 'medicine_missed_dose' as const,
  title: 'Missed dose reminder',
  content: 'You missed your evening dose of Ibuprofen.',
  action: '/record/dose-log' as string | null,
  actionPayload: { medicineId: 'med-1' } as Record<string, unknown> | null,
  isRead: false,
  readAt: null as Date | null,
  createdAt: new Date('2026-06-10T08:00:00.000Z'),
};

const mockReadNotificationRow = {
  ...mockNotificationRow,
  isRead: true,
  readAt: new Date('2026-06-10T12:00:00.000Z'),
};

const mockScopedSuggestionRow = {
  id: 'notif-suggestion-1',
  type: 'ai_proactive_suggestion' as const,
  title: 'AI 主动建议',
  content: '还有 1 项今日用药待确认。',
  action: 'today' as string | null,
  actionPayload: {
    source: 'today-analysis',
    date: '2026-06-12',
    actionLabel: '查看今日记录',
  } as Record<string, unknown> | null,
  isRead: false,
  readAt: null as Date | null,
  createdAt: new Date('2026-06-12T08:00:00.000Z'),
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prismaService: DeepMocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      $transaction: jest.fn(),
      userNotification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a notification and return a list-item DTO', async () => {
      (prismaService.userNotification.create as jest.Mock).mockResolvedValue(
        mockNotificationRow,
      );

      const result = await service.create('user-uuid-1', {
        type: 'medicine_missed_dose',
        title: 'Missed dose reminder',
        content: 'You missed your evening dose of Ibuprofen.',
        action: '/record/dose-log',
        actionPayload: { medicineId: 'med-1' },
      });

      expect(prismaService.userNotification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid-1',
          type: 'medicine_missed_dose',
          title: 'Missed dose reminder',
          content: 'You missed your evening dose of Ibuprofen.',
          action: '/record/dose-log',
          actionPayload: { medicineId: 'med-1' },
        },
        select: expect.objectContaining({
          id: true,
          type: true,
          title: true,
          content: true,
          action: true,
          actionPayload: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        }) as Record<string, boolean>,
      });
      expect(result).toEqual({
        id: 'notif-uuid-1',
        type: 'medicine_missed_dose',
        title: 'Missed dose reminder',
        content: 'You missed your evening dose of Ibuprofen.',
        action: '/record/dose-log',
        actionPayload: { medicineId: 'med-1' },
        isRead: false,
        createdAt: '2026-06-10T08:00:00.000Z',
      });
    });

    it('should create a notification without optional fields', async () => {
      (prismaService.userNotification.create as jest.Mock).mockResolvedValue({
        ...mockNotificationRow,
        action: null,
        actionPayload: null,
      });

      const result = await service.create('user-uuid-1', {
        type: 'system_announcement',
        title: 'System update',
        content: 'The system will be updated tonight.',
      });

      expect(result.action).toBeNull();
      expect(result.actionPayload).toBeNull();
    });
  });

  describe('createOrReplaceScoped', () => {
    it('creates a new notification when no scoped duplicate exists', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockScopedSuggestionRow,
          id: 'notif-suggestion-other-date',
          actionPayload: {
            source: 'today-analysis',
            date: '2026-06-11',
            actionLabel: '查看今日记录',
          },
        },
      ]);
      (prismaService.userNotification.create as jest.Mock).mockResolvedValue({
        ...mockScopedSuggestionRow,
        id: 'notif-suggestion-new',
      });

      const result = await service.createOrReplaceScoped(
        'user-uuid-1',
        {
          type: 'ai_proactive_suggestion',
          title: 'AI 主动建议',
          content: '还有 1 项今日用药待确认。',
          action: 'today',
          actionPayload: {
            source: 'today-analysis',
            date: '2026-06-12',
            actionLabel: '查看今日记录',
          },
        },
        {
          source: 'today-analysis',
          date: '2026-06-12',
        },
      );

      expect(prismaService.userNotification.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          type: 'ai_proactive_suggestion',
        },
        select: expect.any(Object) as Record<string, boolean>,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(prismaService.userNotification.deleteMany).not.toHaveBeenCalled();
      expect(result.id).toBe('notif-suggestion-new');
    });

    it('replaces existing scoped duplicates before creating a fresh notification', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue([
        mockScopedSuggestionRow,
        {
          ...mockScopedSuggestionRow,
          id: 'notif-suggestion-2',
          createdAt: new Date('2026-06-12T07:00:00.000Z'),
        },
        {
          ...mockScopedSuggestionRow,
          id: 'notif-suggestion-other-source',
          actionPayload: {
            source: 'report-summary',
            date: '2026-06-12',
            actionLabel: '查看报告',
          },
        },
      ]);
      (
        prismaService.userNotification.deleteMany as jest.Mock
      ).mockResolvedValue({ count: 2 });
      (prismaService.userNotification.create as jest.Mock).mockResolvedValue({
        ...mockScopedSuggestionRow,
        id: 'notif-suggestion-new',
        createdAt: new Date('2026-06-12T09:00:00.000Z'),
      });

      await service.createOrReplaceScoped(
        'user-uuid-1',
        {
          type: 'ai_proactive_suggestion',
          title: 'AI 主动建议',
          content: '还有 1 项今日用药待确认。',
          action: 'today',
          actionPayload: {
            source: 'today-analysis',
            date: '2026-06-12',
            actionLabel: '查看今日记录',
          },
        },
        {
          source: 'today-analysis',
          date: '2026-06-12',
        },
      );

      expect(prismaService.userNotification.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          id: {
            in: ['notif-suggestion-1', 'notif-suggestion-2'],
          },
        },
      });
      expect(prismaService.userNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-uuid-1',
            type: 'ai_proactive_suggestion',
          }),
        }),
      );
    });

    it('deduplicates notifications with array payload containing matching scope', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockScopedSuggestionRow,
          id: 'notif-array-1',
          actionPayload: [
            { source: 'today-analysis', date: '2026-06-12' },
            { source: 'report-summary', date: '2026-06-12' },
          ],
        },
      ]);
      (
        prismaService.userNotification.deleteMany as jest.Mock
      ).mockResolvedValue({ count: 1 });
      (prismaService.userNotification.create as jest.Mock).mockResolvedValue({
        ...mockScopedSuggestionRow,
        id: 'notif-array-new',
      });

      await service.createOrReplaceScoped(
        'user-uuid-1',
        {
          type: 'ai_proactive_suggestion',
          title: 'AI 主动建议',
          content: '还有 1 项今日用药待确认。',
          action: 'today',
          actionPayload: {
            source: 'today-analysis',
            date: '2026-06-12',
          },
        },
        {
          source: 'today-analysis',
          date: '2026-06-12',
        },
      );

      expect(prismaService.userNotification.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          id: { in: ['notif-array-1'] },
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated items with total count', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue([
        mockNotificationRow,
      ]);
      (prismaService.userNotification.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll('user-uuid-1', {
        page: 1,
        pageSize: 20,
      });

      expect(prismaService.userNotification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
        select: expect.any(Object) as Record<string, boolean>,
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(prismaService.userNotification.count).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should apply pagination offsets correctly', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (prismaService.userNotification.count as jest.Mock).mockResolvedValue(0);

      await service.findAll('user-uuid-1', { page: 3, pageSize: 10 });

      expect(prismaService.userNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('should return empty list when user has no notifications', async () => {
      (prismaService.userNotification.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (prismaService.userNotification.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll('user-uuid-1', {
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return a notification detail DTO when found', async () => {
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        mockReadNotificationRow,
      );

      const result = await service.findOne('user-uuid-1', 'notif-uuid-1');

      expect(prismaService.userNotification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1', userId: 'user-uuid-1' },
        select: expect.any(Object) as Record<string, boolean>,
      });
      expect(result).toEqual({
        id: 'notif-uuid-1',
        type: 'medicine_missed_dose',
        title: 'Missed dose reminder',
        content: 'You missed your evening dose of Ibuprofen.',
        action: '/record/dose-log',
        actionPayload: { medicineId: 'med-1' },
        isRead: true,
        readAt: '2026-06-10T12:00:00.000Z',
        createdAt: '2026-06-10T08:00:00.000Z',
      });
    });

    it('should return null when notification does not exist', async () => {
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findOne('user-uuid-1', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('markAsRead', () => {
    it('should update and return the notification', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 1 });
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        mockReadNotificationRow,
      );

      const result = await service.markAsRead('user-uuid-1', 'notif-uuid-1');

      expect(prismaService.userNotification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1', userId: 'user-uuid-1', isRead: false },
        data: { isRead: true, readAt: expect.any(Date) as Date },
      });
      expect(result?.isRead).toBe(true);
      expect(result?.readAt).toBe('2026-06-10T12:00:00.000Z');
    });

    it('should still return notification when already read', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 0 });
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        mockReadNotificationRow,
      );

      const result = await service.markAsRead('user-uuid-1', 'notif-uuid-1');

      expect(result?.isRead).toBe(true);
    });

    it('should return null when notification belongs to another user', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 0 });
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.markAsRead('other-user', 'notif-uuid-1');

      expect(result).toBeNull();
    });
  });

  describe('markAsUnread', () => {
    it('should mark notification as unread and return it', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 1 });
      (prismaService.userNotification.findFirst as jest.Mock).mockResolvedValue(
        mockNotificationRow,
      );

      const result = await service.markAsUnread('user-uuid-1', 'notif-uuid-1');

      expect(prismaService.userNotification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1', userId: 'user-uuid-1' },
        data: { isRead: false, readAt: null },
      });
      expect(result?.isRead).toBe(false);
      expect(result?.readAt).toBeNull();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read and return count', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead('user-uuid-1');

      expect(prismaService.userNotification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', isRead: false },
        data: { isRead: true, readAt: expect.any(Date) as Date },
      });
      expect(result).toBe(5);
    });

    it('should return 0 when no unread notifications', async () => {
      (
        prismaService.userNotification.updateMany as jest.Mock
      ).mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead('user-uuid-1');

      expect(result).toBe(0);
    });
  });

  describe('remove', () => {
    it('should delete a notification and return true', async () => {
      (
        prismaService.userNotification.deleteMany as jest.Mock
      ).mockResolvedValue({ count: 1 });

      const result = await service.remove('user-uuid-1', 'notif-uuid-1');

      expect(prismaService.userNotification.deleteMany).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1', userId: 'user-uuid-1' },
      });
      expect(result).toBe(true);
    });

    it('should return false when notification does not exist', async () => {
      (
        prismaService.userNotification.deleteMany as jest.Mock
      ).mockResolvedValue({ count: 0 });

      const result = await service.remove('user-uuid-1', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread notifications', async () => {
      (prismaService.userNotification.count as jest.Mock).mockResolvedValue(3);

      const result = await service.getUnreadCount('user-uuid-1');

      expect(prismaService.userNotification.count).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', isRead: false },
      });
      expect(result).toBe(3);
    });

    it('should return 0 when there are no unread notifications', async () => {
      (prismaService.userNotification.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getUnreadCount('user-uuid-1');

      expect(result).toBe(0);
    });
  });
});
