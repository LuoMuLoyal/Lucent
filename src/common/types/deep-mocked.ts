/**
 * Recursively mocks all function properties of T, including nested objects.
 *
 * Unlike `jest.Mocked<T>` which only applies `jest.MockedFunction` to
 * top-level function properties, `DeepMocked` traverses into nested
 * delegate objects (e.g. Prisma's `prisma.user.create`) so that
 * `.mockResolvedValue()` and `.mock` are available at every depth.
 *
 * The `& T` intersection ensures `DeepMocked<T>` remains assignable to `T`,
 * so it can be passed to constructors that expect the original type.
 *
 * Usage:
 *   let prisma: DeepMocked<PrismaService>;
 *   prisma = { ... } as unknown as DeepMocked<PrismaService>;
 *   prisma.userSession.create.mockResolvedValue(...);
 */
export type DeepMocked<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [P in keyof T]: T[P] extends (...args: any[]) => any
    ? jest.Mock
    : T[P] extends object
      ? DeepMocked<T[P]>
      : T[P];
} & T;
