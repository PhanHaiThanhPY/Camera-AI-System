import { Module } from "@nestjs/common";
import { GateModule } from "./gate/gate.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, GateModule]
})
export class AppModule {}

