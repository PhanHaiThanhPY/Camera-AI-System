import { Module } from "@nestjs/common";
import { GateModule } from "./gate/gate.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, GateModule],
  controllers: [HealthController]
})
export class AppModule {}

