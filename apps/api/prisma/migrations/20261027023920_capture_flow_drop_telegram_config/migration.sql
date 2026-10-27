/*
  Warnings:

  - You are about to drop the `TelegramConfig` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "GatePass" ADD COLUMN     "captureAttempts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "captureState" TEXT;

-- DropTable
DROP TABLE "TelegramConfig";
