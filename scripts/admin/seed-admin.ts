import { PrismaPg } from '@prisma/adapter-pg';
import { AdminRole, PrismaClient, UserStatus } from '#generated/prisma/client.js';
import { loadEnvironment } from '../shared/env.ts';

loadEnvironment();

const [emailArgument, roleArgument] = process.argv.slice(2);
const roles = Object.values(AdminRole);

if (
  emailArgument === undefined ||
  roleArgument === undefined ||
  !roles.includes(roleArgument as AdminRole)
) {
  console.error(`Usage: pnpm admin:seed <verified-user-email> <${roles.join('|')}>`);
  process.exitCode = 1;
} else {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 1;
  } else {
    const email = emailArgument.trim().toLowerCase();
    const role = roleArgument as AdminRole;
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });

    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, status: true, emailVerified: true },
      });

      if (user === null || user.status !== UserStatus.active || !user.emailVerified) {
        console.error('An active user with a verified email is required.');
        process.exitCode = 1;
      } else {
        await prisma.adminUser.upsert({
          where: { userId: user.id },
          create: { userId: user.id, role },
          update: { role },
        });
        console.info(`Granted ${role} to ${email}.`);
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
