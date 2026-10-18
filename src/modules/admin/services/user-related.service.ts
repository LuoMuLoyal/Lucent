import { Injectable } from '@nestjs/common';
import {
  ADMIN_USER_RELATED_GROUPS,
  getAdminResource,
  type AdminResource,
  type AdminUserRelatedGroup,
} from '../constants/resource-registry.js';
import { AdminDataService } from './data.service.js';

export interface AdminUserRelatedSection {
  resource: string;
  items: Record<string, unknown>[];
  total: number;
}

export interface AdminUserRelatedGroupView {
  key: string;
  sections: AdminUserRelatedSection[];
}

export interface AdminUserRelatedView {
  userId: string;
  groups: AdminUserRelatedGroupView[];
}

/**
 * Aggregates every user-owned table for `GET /admin/users/:id/related`
 * (plan `2026-10-18-admin-management-expansion` §2.1, user-detail tabs).
 *
 * Groups and resources come from `resource-registry.ts`, so this stays a thin
 * fan-out over `AdminDataService` and inherits its sanitisation and soft-delete
 * filtering. Each section returns a bounded preview; the full list is paged
 * through `/admin/data/:resource?userId=...`.
 */
@Injectable()
export class AdminUserRelatedService {
  constructor(private readonly data: AdminDataService) {}

  async getForUser(
    userId: string,
    limit: number,
  ): Promise<AdminUserRelatedView | null> {
    const userResource = getAdminResource('users');
    if (userResource === undefined) return null;

    const user = await this.data.getOne(userResource, userId);
    if (user === null) return null;

    const groups = await Promise.all(
      ADMIN_USER_RELATED_GROUPS.map((group) =>
        this.loadGroup(group, userId, limit),
      ),
    );
    return { userId, groups };
  }

  private async loadGroup(
    group: AdminUserRelatedGroup,
    userId: string,
    limit: number,
  ): Promise<AdminUserRelatedGroupView> {
    const sections = await Promise.all(
      group.resources.map((resource) =>
        this.loadSection(resource, userId, limit),
      ),
    );
    return { key: group.key, sections };
  }

  private async loadSection(
    resource: AdminResource,
    userId: string,
    limit: number,
  ): Promise<AdminUserRelatedSection> {
    // One-to-one tables (UserProfile, UserNotificationPreference) are keyed by
    // `userId`, so they are fetched directly rather than listed.
    if (resource.idField === 'userId') {
      const row = await this.data.getOne(resource, userId);
      const items = row === null ? [] : [row];
      return { resource: resource.key, items, total: items.length };
    }

    const page = await this.data.list(resource, {
      page: 1,
      limit,
      order: 'desc',
      userId,
    });
    return { resource: resource.key, items: page.items, total: page.total };
  }
}
