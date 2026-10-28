import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { SitesController } from "./sites.controller";
import { SitesService } from "./sites.service";

@Module({
  imports: [UsersModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService]
})
export class SitesModule {}
