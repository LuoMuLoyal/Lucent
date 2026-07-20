/**
 * Tests for the soft-delete Prisma extension.
 *
 * The extension is defined via `Prisma.defineExtension((client) => client.$extends({ model: ... }))`.
 * To test it we create a mock PrismaClient whose `$extends` method:
 *   - When called with a function (the outer defineExtension callback):
 *     calls that function with the client and returns the result.
 *   - When called with a plain object (the inner $extends({ model: ... })):
 *     merges the `model` overrides into a new client copy.
 *
 * This mirrors how the real PrismaClient processes extensions at runtime.
 */

const SOFT_DELETE_MODELS = [
  'user',
  'userDailyRecord',
  'userMedicineReminder',
  'userMedicineDoseLog',
] as const;

const NONDELETED_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
] as const;

const UNIQUE_METHODS = ['findUnique', 'findUniqueOrThrow'] as const;

type MockFn = ReturnType<typeof vi.fn>;

/** A mock model with all Prisma query methods as vi.fn spies. */
interface MockModel {
  findMany: MockFn;
  findFirst: MockFn;
  findFirstOrThrow: MockFn;
  findUnique: MockFn;
  findUniqueOrThrow: MockFn;
  count: MockFn;
}

/** A mock PrismaClient with typed model delegates and $extends. */
interface MockClient {
  user: MockModel;
  userDailyRecord: MockModel;
  userMedicineReminder: MockModel;
  userMedicineDoseLog: MockModel;
  $extends: (ext: unknown) => unknown;
}

function makeModel(): MockModel {
  return {
    findMany: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findFirstOrThrow: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(null),
  };
}

/** Creates a mock PrismaClient with spies on all model methods. */
function createMockClient(): MockClient {
  const client: MockClient = {
    user: makeModel(),
    userDailyRecord: makeModel(),
    userMedicineReminder: makeModel(),
    userMedicineDoseLog: makeModel(),
    $extends: (ext: unknown): unknown => {
      if (typeof ext === 'function') {
        return (ext as (c: MockClient) => unknown)(client);
      }
      const extObj = ext as { model?: Record<string, unknown> };
      if (extObj.model) {
        const merged: MockClient = {
          user: { ...client.user },
          userDailyRecord: { ...client.userDailyRecord },
          userMedicineReminder: { ...client.userMedicineReminder },
          userMedicineDoseLog: { ...client.userMedicineDoseLog },
          $extends: client.$extends,
        };
        for (const [modelName, overrides] of Object.entries(extObj.model)) {
          const target = (merged as unknown as Record<string, MockModel>)[
            modelName
          ];
          if (target) {
            Object.assign(target, overrides);
          }
        }
        return merged;
      }
      return client;
    },
  };

  return client;
}

// Mock #generated/prisma/client so Prisma.defineExtension is a passthrough
vi.mock('#generated/prisma/client', () => ({
  Prisma: {
    defineExtension: <T>(fn: T): T => fn,
  },
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  PrismaClient: class MockPrismaClient {},
}));

import { applySoftDeleteExtension } from './prisma.extension';

/** Helper to get a model delegate from the mock client by name. */
function getModel(
  client: MockClient,
  model: (typeof SOFT_DELETE_MODELS)[number],
): MockModel {
  switch (model) {
    case 'user':
      return client.user;
    case 'userDailyRecord':
      return client.userDailyRecord;
    case 'userMedicineReminder':
      return client.userMedicineReminder;
    case 'userMedicineDoseLog':
      return client.userMedicineDoseLog;
  }
}

/** Helper to get a method spy from a mock model by name. */
function getMethod(
  model: MockModel,
  method: (typeof NONDELETED_METHODS)[number] | (typeof UNIQUE_METHODS)[number],
): MockFn {
  switch (method) {
    case 'findMany':
      return model.findMany;
    case 'findFirst':
      return model.findFirst;
    case 'findFirstOrThrow':
      return model.findFirstOrThrow;
    case 'findUnique':
      return model.findUnique;
    case 'findUniqueOrThrow':
      return model.findUniqueOrThrow;
    case 'count':
      return model.count;
  }
}

/** Helper to call a nonDeleted method on the extended client. */
function callNonDeleted(
  extended: ReturnType<typeof applySoftDeleteExtension>,
  model: (typeof SOFT_DELETE_MODELS)[number],
  method: (typeof NONDELETED_METHODS)[number] | (typeof UNIQUE_METHODS)[number],
  args: unknown,
): Promise<unknown> {
  const extendedClient = extended as unknown as Record<
    string,
    { nonDeleted: Record<string, (args?: unknown) => Promise<unknown>> }
  >;
  const modelDelegate = extendedClient[model];
  if (!modelDelegate) throw new Error(`Model ${model} not found`);
  const fn = modelDelegate.nonDeleted[method];
  if (!fn) throw new Error(`Method ${method} not found`);
  return fn(args);
}

describe('prisma.extension (soft-delete)', () => {
  let mockClient: MockClient;
  let extended: ReturnType<typeof applySoftDeleteExtension>;

  beforeEach(() => {
    mockClient = createMockClient();
    extended = applySoftDeleteExtension(
      mockClient as unknown as Parameters<typeof applySoftDeleteExtension>[0],
    );
  });

  // ── Structure: nonDeleted namespace exists on all four models ──────────

  describe('nonDeleted namespace', () => {
    for (const model of SOFT_DELETE_MODELS) {
      it(`exposes nonDeleted on ${model}`, () => {
        const extendedClient = extended as unknown as Record<
          string,
          { nonDeleted: unknown }
        >;
        const modelDelegate = extendedClient[model];
        expect(modelDelegate?.nonDeleted).toBeDefined();
      });
    }
  });

  // ── findMany / findFirst / findFirstOrThrow / count ─────────────────────

  describe('non-deleted filter injection (findMany/findFirst/findFirstOrThrow/count)', () => {
    for (const model of SOFT_DELETE_MODELS) {
      for (const method of NONDELETED_METHODS) {
        it(`${model}.nonDeleted.${method} injects deletedAt: null into where`, async () => {
          await callNonDeleted(extended, model, method, {
            where: { name: 'test' },
          });

          const spy = getMethod(getModel(mockClient, model), method);
          expect(spy).toHaveBeenCalledTimes(1);
          const callArgs = spy.mock.calls[0]?.[0];
          expect(callArgs?.where).toEqual({ name: 'test', deletedAt: null });
        });
      }
    }

    it('handles undefined where clause by injecting only deletedAt: null', async () => {
      await extended.user.nonDeleted.findMany();

      const spy = mockClient.user.findMany;
      expect(spy).toHaveBeenCalledTimes(1);
      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.where).toEqual({ deletedAt: null });
    });

    it('preserves other args (select, orderBy, take, skip) alongside the where injection', async () => {
      await extended.user.nonDeleted.findMany({
        where: { email: 'a@b.com' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });

      const spy = mockClient.user.findMany;
      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.where).toEqual({ email: 'a@b.com', deletedAt: null });
      expect(callArgs?.select).toEqual({ id: true });
      expect(callArgs?.orderBy).toEqual({ createdAt: 'desc' });
      expect(callArgs?.take).toBe(10);
      expect(callArgs?.skip).toBe(0);
    });
  });

  // ── findUnique / findUniqueOrThrow ──────────────────────────────────────

  describe('unique filter injection (findUnique/findUniqueOrThrow)', () => {
    for (const model of SOFT_DELETE_MODELS) {
      for (const method of UNIQUE_METHODS) {
        it(`${model}.nonDeleted.${method} injects deletedAt: null into where`, async () => {
          await callNonDeleted(extended, model, method, {
            where: { id: 'user-123' },
          });

          const spy = getMethod(getModel(mockClient, model), method);
          expect(spy).toHaveBeenCalledTimes(1);
          const callArgs = spy.mock.calls[0]?.[0];
          expect(callArgs?.where).toEqual({ id: 'user-123', deletedAt: null });
        });
      }
    }

    it('preserves select on findUnique alongside the where injection', async () => {
      await extended.user.nonDeleted.findUnique({
        where: { id: 'user-1' },
        select: { id: true, email: true },
      });

      const spy = mockClient.user.findUnique;
      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.where).toEqual({ id: 'user-1', deletedAt: null });
      expect(callArgs?.select).toEqual({ id: true, email: true });
    });
  });

  // ── count ───────────────────────────────────────────────────────────────

  describe('count', () => {
    it('injects deletedAt: null when no where is provided', async () => {
      await extended.user.nonDeleted.count();

      const spy = mockClient.user.count;
      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.where).toEqual({ deletedAt: null });
    });

    it('injects deletedAt: null alongside existing where conditions', async () => {
      await extended.userMedicineDoseLog.nonDeleted.count({
        where: { userId: 'user-1' },
      });

      const spy = mockClient.userMedicineDoseLog.count;
      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.where).toEqual({ userId: 'user-1', deletedAt: null });
    });
  });
});
