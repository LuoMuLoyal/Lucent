// Task 1 spike: sign up a credential user via Better Auth and verify it lands
// in the Better Auth `BAUser` table and the `accounts` table.
//
// Run with: NODE_ENV=test npx jiti scripts/spike/better-auth-spike.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#generated/prisma/client.js';
import { auth } from './better-auth.config.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const email = `spike-${Date.now()}@lucent.local`;
  const password = 'SpikePassword123!';
  const name = 'Better Auth Spike';

  console.log(`[spike] Signing up ${email} via Better Auth...`);

  const signUpResult = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  const user = signUpResult.user;
  if (!user?.id) {
    throw new Error('Better Auth sign up did not return a user');
  }

  console.log(`[spike] Better Auth returned user id=${user.id}`);

  try {
    const dbUser = await prisma.bAUser.findUnique({
      where: { id: user.id },
    });

    if (!dbUser) {
      throw new Error(`User row not found in BAUser table for id=${user.id}`);
    }

    if (dbUser.email !== email) {
      throw new Error(
        `Email mismatch: expected ${email}, got ${dbUser.email ?? 'null'}`,
      );
    }

    if (dbUser.name !== name) {
      throw new Error(`Name mismatch: expected ${name}, got ${dbUser.name}`);
    }

    console.log(`[spike] Verified BAUser row: id=${dbUser.id}`);

    const account = await prisma.account.findFirst({
      where: {
        userId: user.id,
        providerId: 'credential',
      },
    });

    if (!account) {
      throw new Error(
        `Credential account row not found for user id=${user.id}`,
      );
    }

    if (!account.password || account.password.length === 0) {
      throw new Error('Credential account row exists but has no password hash');
    }

    console.log(`[spike] Verified credential Account row: id=${account.id}`);

    console.log(
      '[spike] SUCCESS: Better Auth user + credential account created via Prisma adapter.',
    );
  } finally {
    // Clean up the spike user and its dependent rows to avoid accumulating
    // test data across repeated runs.
    await prisma.bAUser
      .delete({ where: { id: user.id } })
      .catch((error: unknown) => {
        console.error('[spike] cleanup warning:', error);
      });
  }
}

main()
  .catch((error: unknown) => {
    console.error('[spike] FAILURE:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
