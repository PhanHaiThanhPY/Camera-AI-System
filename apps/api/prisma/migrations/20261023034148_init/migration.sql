-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "vehicleType" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "licenseNo" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatePass" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "plateNormalized" TEXT NOT NULL,
    "videoJobId" TEXT,
    "status" TEXT NOT NULL,
    "visitStatus" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PENDING',
    "capture" JSONB NOT NULL,
    "exitCapture" JSONB,
    "vehicleType" JSONB NOT NULL,
    "material" JSONB NOT NULL,
    "weighing" JSONB,
    "checks" JSONB NOT NULL,
    "statusReasons" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "effective" JSONB NOT NULL,
    "master" JSONB NOT NULL,
    "audit" JSONB NOT NULL,

    CONSTRAINT "GatePass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeighReading" (
    "id" TEXT NOT NULL,
    "scaleId" TEXT NOT NULL,
    "ticketNo" TEXT,
    "plateNumber" TEXT,
    "grossKg" DOUBLE PRECISION,
    "tareKg" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "gatePassId" TEXT,

    CONSTRAINT "WeighReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "botToken" TEXT NOT NULL DEFAULT '',
    "botUsername" TEXT NOT NULL DEFAULT '',
    "chatId" TEXT NOT NULL DEFAULT '',
    "chatTitle" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TelegramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNormalized_key" ON "Vehicle"("plateNormalized");

-- CreateIndex
CREATE INDEX "Vehicle_plateNormalized_idx" ON "Vehicle"("plateNormalized");

-- CreateIndex
CREATE INDEX "Driver_vehicleId_idx" ON "Driver"("vehicleId");

-- CreateIndex
CREATE INDEX "GatePass_plateNormalized_idx" ON "GatePass"("plateNormalized");

-- CreateIndex
CREATE INDEX "GatePass_status_idx" ON "GatePass"("status");

-- CreateIndex
CREATE INDEX "GatePass_resolution_idx" ON "GatePass"("resolution");

-- CreateIndex
CREATE INDEX "GatePass_capturedAt_idx" ON "GatePass"("capturedAt");

-- CreateIndex
CREATE INDEX "GatePass_videoJobId_idx" ON "GatePass"("videoJobId");

-- CreateIndex
CREATE INDEX "WeighReading_gatePassId_idx" ON "WeighReading"("gatePassId");

-- CreateIndex
CREATE INDEX "WeighReading_plateNumber_idx" ON "WeighReading"("plateNumber");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeighReading" ADD CONSTRAINT "WeighReading_gatePassId_fkey" FOREIGN KEY ("gatePassId") REFERENCES "GatePass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
