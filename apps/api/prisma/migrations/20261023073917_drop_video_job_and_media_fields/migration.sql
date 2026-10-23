/*
  Warnings:

  - You are about to drop the column `videoJobId` on the `GatePass` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "GatePass_videoJobId_idx";

-- AlterTable
ALTER TABLE "GatePass" DROP COLUMN "videoJobId";
