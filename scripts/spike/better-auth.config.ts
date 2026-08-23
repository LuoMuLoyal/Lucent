// Temporary spike config for Better Auth integration (Task 1).
// Do not wire this into NestJS controllers or expose it to the network.
import * as dotenv from 'dotenv';
import * as path from 'path';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#generated/prisma/client.js';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../../src/modules/auth/config/argon2-options.js';

// The spike is always run from the repository root.
dotenv.config({
  path: path.resolve('.env.test'),
  override: true,
});

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the Better Auth spike config');
}

const betterAuthSecret = process.env['BETTER_AUTH_SECRET'];
if (!betterAuthSecret) {
  throw new Error(
    'BETTER_AUTH_SECRET is required for the Better Auth spike config',
  );
}

const betterAuthUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: betterAuthSecret,
  baseURL: betterAuthUrl,
  user: {
    modelName: 'BAUser',
  },
  emailAndPassword: {
    enabled: true,
    password: {
      hash: async (password: string) => argon2.hash(password, ARGON2_OPTIONS),
      verify: async (data: { hash: string; password: string }) =>
        argon2.verify(data.hash, data.password, ARGON2_OPTIONS),
    },
  },
});
