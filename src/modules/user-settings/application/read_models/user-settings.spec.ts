import {
  createDomainFailure,
  DomainFailureException,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { SettingsRepository } from '../../domain/settings/settings.js';
import type { SettingRowSnapshot } from '../../domain/settings/settings.js';
import type {
  SettingUpsert,
  SettingValue,
} from '../../domain/settings/setting-key.js';
import { SettingsCache } from '../ports/settings-cache.js';
import { SettingsEvents } from '../ports/settings-events.js';
import type { UserSettingsView } from './user-settings.js';
import { UserSettingsReadModel } from './user-settings.js';
import { UpdateUserSettings } from '../use_cases/update-settings.js';

class FakeRepository extends SettingsRepository {
  rows: SettingRowSnapshot[] = [];
  upserts: Array<{ userId: string; upserts: SettingUpsert[] }> = [];
  seeded: Array<{ userId: string; defaults: unknown }> = [];
  failWrite: 'conflict' | 'unknown' | null = null;

  listRows(): Promise<SettingRowSnapshot[]> {
    return Promise.resolve(this.rows);
  }

  upsertMany(userId: string, upserts: SettingUpsert[]): Promise<void> {
    this.upserts.push({ userId, upserts });
    if (this.failWrite === 'conflict') {
      // The Prisma adapter rejects with the mapped failure, not the raw P2002.
      return Promise.resolve().then(() => {
        throw new DomainFailureException(
          createDomainFailure({ kind: 'conflict', code: 'RESOURCE_CONFLICT' }),
        );
      });
    }
    if (this.failWrite === 'unknown') {
      return Promise.resolve().then(() => {
        throw new Error('connection lost');
      });
    }
    for (const { key, value } of upserts) {
      this.rows = [
        { key, value, updatedAt: new Date('2026-07-01T00:00:00.000Z') },
        ...this.rows.filter((row) => row.key !== key),
      ];
    }
    return Promise.resolve();
  }

  seedDefaults(
    userId: string,
    defaults: ReadonlyArray<{ key: string; value: SettingValue }>,
  ): Promise<void> {
    this.seeded.push({ userId, defaults });
    return Promise.resolve();
  }
}

class FakeCache extends SettingsCache {
  entries = new Map<string, UserSettingsView>();
  invalidations: string[] = [];

  read(userId: string): Promise<UserSettingsView | undefined> {
    return Promise.resolve(this.entries.get(userId));
  }

  write(userId: string, value: UserSettingsView): Promise<void> {
    this.entries.set(userId, value);
    return Promise.resolve();
  }

  invalidate(userId: string): Promise<void> {
    this.invalidations.push(userId);
    this.entries.delete(userId);
    return Promise.resolve();
  }
}

class FakeEvents extends SettingsEvents {
  published: string[] = [];

  settingsChanged(userId: string): ResultAsync<void, DomainFailure> {
    this.published.push(userId);
    return okAsync(undefined);
  }
}

async function unwrap<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  return result.match(
    (value) => value,
    (error) => {
      throw new Error(`Expected ok, got ${error.code}`);
    },
  );
}

function build() {
  const repository = new FakeRepository();
  const cache = new FakeCache();
  const events = new FakeEvents();
  const readModel = new UserSettingsReadModel(repository, cache);
  const useCase = new UpdateUserSettings(repository, cache, events, readModel);
  return { repository, cache, events, readModel, useCase };
}

describe('UserSettingsReadModel', () => {
  it('returns defaults and caches the rendered view', async () => {
    const { cache, readModel } = build();

    const view = await readModel.get('user-1');

    expect(view.updatedAt).toBeNull();
    expect(view.passwordReauthenticationRequired).toBe(true);
    expect(cache.entries.get('user-1')).toEqual(view);
  });

  it('serves a cache hit without re-assembling the aggregate', async () => {
    const { cache, readModel } = build();
    const cached: UserSettingsView = {
      aiSummariesEnabled: false,
      dataSharingConsent: true,
      assistantEnabled: false,
      assistantMemoryEnabled: true,
      waterTargetCount: 3,
      assistantContext: {
        healthProfile: false,
        dailyRecords: false,
        sleepRecords: false,
        currentMedicines: false,
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
      passwordReauthenticationRequired: true,
    };
    cache.entries.set('user-1', cached);

    await expect(readModel.get('user-1')).resolves.toEqual(cached);
  });
});

describe('UpdateUserSettings use case', () => {
  it('writes rows, invalidates the cache, publishes and re-reads', async () => {
    const { repository, cache, events, useCase } = build();

    const view = await unwrap(
      useCase.execute('user-1', { assistantEnabled: false }),
    );

    expect(repository.upserts).toEqual([
      {
        userId: 'user-1',
        upserts: [{ key: 'assistantEnabled', value: false }],
      },
    ]);
    expect(cache.invalidations).toEqual(['user-1']);
    expect(events.published).toEqual(['user-1']);
    expect(view.assistantEnabled).toBe(false);
    // The re-read is cached again, so the next GET avoids storage.
    expect(cache.entries.get('user-1')).toEqual(view);
  });

  it('is a no-op read for an empty patch', async () => {
    const { repository, cache, events, useCase } = build();

    const view = await unwrap(useCase.execute('user-1', {}));

    expect(repository.upserts).toEqual([]);
    expect(cache.invalidations).toEqual([]);
    expect(events.published).toEqual([]);
    expect(view.aiSummariesEnabled).toBe(true);
  });

  it('writes assistant context toggles as individual rows', async () => {
    const { repository, useCase } = build();

    await unwrap(
      useCase.execute('user-1', {
        assistantContext: { healthProfile: false, sleepRecords: false },
      }),
    );

    expect(repository.upserts[0]?.upserts).toEqual([
      { key: 'assistantContext.healthProfile', value: false },
      { key: 'assistantContext.sleepRecords', value: false },
    ]);
  });

  it('surfaces a unique-violation race as RESOURCE_CONFLICT', async () => {
    const { repository, useCase } = build();
    repository.failWrite = 'conflict';

    const outcome = await useCase
      .execute('user-1', { assistantEnabled: false })
      .match(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, code: error.code }),
      );

    expect(outcome).toEqual({ ok: false, code: 'RESOURCE_CONFLICT' });
  });

  it('rethrows unknown database errors instead of mapping them to 4xx', async () => {
    const { repository, useCase } = build();
    repository.failWrite = 'unknown';

    await expect(
      useCase.execute('user-1', { assistantEnabled: false }),
    ).rejects.toThrow('connection lost');
  });
});
