import { Module } from "@nestjs/common";
import { VideosModule } from "../videos/videos.module";
import { GateController } from "./gate.controller";
import { GatePassesService } from "./gate-passes.service";
import { LiveController } from "./live.controller";

@Module({
  imports: [VideosModule],
  controllers: [GateController, LiveController],
  providers: [GatePassesService]
})
export class GateModule {}
