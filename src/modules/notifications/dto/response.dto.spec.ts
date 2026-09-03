import { describe, expect, it } from 'vitest';
import {
  notificationDetailSchema,
  notificationListItemSchema,
  notificationListSchema,
  unreadCountSchema,
} from './response.dto.js';

/**
 * Outbound-shape contract for the notifications response schemas. These
 * schemas are consumed by `StandardSchemaSerializerInterceptor` — a failed
 * parse throws (`Serialization failed: …` → 500), so they must accept exactly
 * what the service layer puts on the wire, including the permissive
 * `actionPayload` JSON posture.
 */
const itemPayload = {
  id: 'notif-uuid-1',
  type: 'medicine_reminder',
  title: 'Missed dose reminder',
  content: 'You missed your evening dose of Ibuprofen.',
  action: '/record/dose-log',
  actionPayload: { medicineId: 'med-1' },
  isRead: false,
  createdAt: '2026-06-10T08:00:00.000Z',
};

describe('notificationListItemSchema', () => {
  it('parses the exact service-layer list-entry shape', () => {
    const result = notificationListItemSchema.safeParse(itemPayload);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(itemPayload);
  });

  it('accepts null action and null/absent actionPayload', () => {
    for (const actionPayload of [null, undefined]) {
      const result = notificationListItemSchema.safeParse({
        ...itemPayload,
        action: null,
        actionPayload,
      });
      expect(result.success).toBe(true);
    }
  });

  it('tolerates legacy JSON actionPayload values (array/primitive) so the outbound serializer never throws', () => {
    for (const actionPayload of [
      [{ source: 'scope', date: '2026-06-10' }],
      'plain-string',
      42,
    ]) {
      const result = notificationListItemSchema.safeParse({
        ...itemPayload,
        actionPayload,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an out-of-enum type and a missing required key', () => {
    expect(
      notificationListItemSchema.safeParse({ ...itemPayload, type: 'nope' })
        .success,
    ).toBe(false);

    const { id: _id, ...withoutId } = itemPayload;
    expect(notificationListItemSchema.safeParse(withoutId).success).toBe(false);
  });

  it('strips unknown keys (no .strict() on response schemas)', () => {
    const result = notificationListItemSchema.safeParse({
      ...itemPayload,
      extraKey: true,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty('extraKey');
  });
});

describe('notificationDetailSchema', () => {
  it('parses a detail with readAt null and with readAt set', () => {
    const unread = notificationDetailSchema.safeParse({
      ...itemPayload,
      readAt: null,
    });
    expect(unread.success).toBe(true);

    const read = notificationDetailSchema.safeParse({
      ...itemPayload,
      readAt: '2026-06-10T09:00:00.000Z',
    });
    expect(read.success).toBe(true);
  });

  it('rejects a detail without readAt', () => {
    expect(notificationDetailSchema.safeParse(itemPayload).success).toBe(false);
  });
});

describe('notificationListSchema', () => {
  it('parses the paginated list shape', () => {
    const result = notificationListSchema.safeParse({
      items: [itemPayload],
      total: 1,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.total).toBe(1);
  });
});

describe('unreadCountSchema', () => {
  it('parses the count shape', () => {
    const result = unreadCountSchema.safeParse({ count: 3 });
    expect(result.success).toBe(true);
    expect(result.success && result.data.count).toBe(3);
  });
});
