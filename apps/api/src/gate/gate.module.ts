import { Module } from "@nestjs/common";
import { VideosModule } from "../videos/videos.module";
import { GateController } from "./gate.controller";
import { GatePassesService } from "./gate-passes.service";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";
import { MasterController } from "./master.controller";
import { MasterDataService } from "./master-data.service";
import { LiveController } from "./live.controller";

@Module({
  imports: [VideosModule],
  controllers: [GateController, LiveController, MasterController, TelegramController],
  providers: [GatePassesService, MasterDataService, TelegramService]
})
export class GateModule {}
