import { Module } from "@nestjs/common";
import { GateController } from "./gate.controller";
import { GatePassesService } from "./gate-passes.service";
import { GatePassRepository } from "./gate-pass.repository";
import { WeighReadingRepository } from "./weigh-reading.repository";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";
import { AssistantService } from "./assistant.service";
import { MasterController } from "./master.controller";
import { MasterDataService } from "./master-data.service";
import { LiveController } from "./live.controller";
import { DemoSeedService } from "./demo-seed.service";

@Module({
  controllers: [GateController, LiveController, MasterController, TelegramController],
  providers: [GatePassesService, GatePassRepository, WeighReadingRepository, MasterDataService, TelegramService, AssistantService, DemoSeedService]
})
export class GateModule {}
