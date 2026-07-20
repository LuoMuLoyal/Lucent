-- AlterEnum: Add new notification types
ALTER TYPE "UserNotificationType" ADD VALUE IF NOT EXISTS 'oauth_login';
ALTER TYPE "UserNotificationType" ADD VALUE IF NOT EXISTS 'identity_linked';
