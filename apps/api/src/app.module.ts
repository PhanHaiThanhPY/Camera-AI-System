import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { GateModule } from "./gate/gate.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { SitesModule } from "./sites/sites.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, SitesModule, GateModule],
  controllers: [HealthController]
})
export class AppModule {}

