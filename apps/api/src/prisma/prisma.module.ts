import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Global để mọi module khác inject PrismaService mà không cần import lại. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService]
})
export class PrismaModule {}
