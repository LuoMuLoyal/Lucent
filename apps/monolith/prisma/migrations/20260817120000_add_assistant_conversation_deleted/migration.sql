-- AlterEnum: Add 'deleted' status for soft-deleted assistant conversations
ALTER TYPE "AssistantConversationStatus" ADD VALUE IF NOT EXISTS 'deleted';
