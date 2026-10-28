-- Multi-tenant: Site/SiteCamera + ownerId (Vehicle/Driver) + siteId (GatePass/WeighReading).
-- Viết tay (không phải `prisma migrate dev` tự sinh) vì DB đã có dữ liệu thật (18 GatePass, 32
-- WeighReading, 1 Vehicle, 2 Driver) lúc thêm cột NOT NULL — cần backfill trước khi ép NOT NULL.
-- Toàn bộ dữ liệu cũ (trước khi có khái niệm Site) được gán cho 1 "Site mặc định" thuộc về tài
-- khoản ADMIN đầu tiên (admin xem được mọi dữ liệu, nên không mất gì — chỉ là chưa được phân loại
-- về đúng cơ sở nào, admin có thể dọn/xoá sau nếu là dữ liệu test).

-- CreateTable: Site
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scaleId" TEXT NOT NULL,
    "weighbridgeApiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Site_scaleId_key" ON "Site"("scaleId");
CREATE INDEX "Site_ownerId_idx" ON "Site"("ownerId");
ALTER TABLE "Site" ADD CONSTRAINT "Site_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SiteCamera
CREATE TABLE "SiteCamera" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "rtspUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteCamera_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteCamera_cameraId_key" ON "SiteCamera"("cameraId");
CREATE INDEX "SiteCamera_siteId_idx" ON "SiteCamera"("siteId");
ALTER TABLE "SiteCamera" ADD CONSTRAINT "SiteCamera_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: 1 Site mặc định thuộc về ADMIN đầu tiên, chứa toàn bộ dữ liệu tạo trước khi có Site.
INSERT INTO "Site" ("id", "ownerId", "name", "scaleId", "weighbridgeApiKey", "createdAt", "updatedAt")
SELECT '504c06a8-0170-47ad-a37e-421971abc6e1', "id", 'Cơ sở mặc định (dữ liệu trước multi-tenant)', 'LEGACY-97676b62', '9079a62708694fe111072c501631291a24cb4e3ddf1f17bc', now(), now()
FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1;

-- AlterTable: Vehicle — thêm ownerId (backfill = admin đầu tiên), đổi unique toàn cục -> theo owner.
ALTER TABLE "Vehicle" ADD COLUMN "ownerId" TEXT;
UPDATE "Vehicle" SET "ownerId" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Vehicle" ALTER COLUMN "ownerId" SET NOT NULL;
DROP INDEX "Vehicle_plateNormalized_key";
CREATE UNIQUE INDEX "Vehicle_ownerId_plateNormalized_key" ON "Vehicle"("ownerId", "plateNormalized");
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Driver — thêm ownerId (backfill = admin đầu tiên).
ALTER TABLE "Driver" ADD COLUMN "ownerId" TEXT;
UPDATE "Driver" SET "ownerId" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Driver" ALTER COLUMN "ownerId" SET NOT NULL;
CREATE INDEX "Driver_ownerId_idx" ON "Driver"("ownerId");
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: GatePass — thêm siteId (backfill = Site mặc định).
ALTER TABLE "GatePass" ADD COLUMN "siteId" TEXT;
UPDATE "GatePass" SET "siteId" = '504c06a8-0170-47ad-a37e-421971abc6e1';
ALTER TABLE "GatePass" ALTER COLUMN "siteId" SET NOT NULL;
CREATE INDEX "GatePass_siteId_idx" ON "GatePass"("siteId");
ALTER TABLE "GatePass" ADD CONSTRAINT "GatePass_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: WeighReading — thêm siteId (backfill = Site mặc định).
ALTER TABLE "WeighReading" ADD COLUMN "siteId" TEXT;
UPDATE "WeighReading" SET "siteId" = '504c06a8-0170-47ad-a37e-421971abc6e1';
ALTER TABLE "WeighReading" ALTER COLUMN "siteId" SET NOT NULL;
CREATE INDEX "WeighReading_siteId_idx" ON "WeighReading"("siteId");
ALTER TABLE "WeighReading" ADD CONSTRAINT "WeighReading_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
