/*
  Warnings:

  - Added the required column `action` to the `assistant_summary_histories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "assistant_summary_histories" ADD COLUMN     "action" TEXT NOT NULL;
