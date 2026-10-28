import { Module } from "@nestjs/common";
import { SitesModule } from "../sites/sites.module";
import { GateController } from "./gate.controller";
import { GatePassesService } from "./gate-passes.service";
import { GatePassRepository } from "./gate-pass.repository";
import { WeighReadingRepository } from "./weigh-reading.repository";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";
import { MasterController } from "./master.controller";
import { MasterDataService } from "./master-data.service";
import { LiveController } from "./live.controller";
import { DemoSeedService } from "./demo-seed.service";
import { DriversController } from "./drivers.controller";
import { GateExcelService } from "./gate-excel.service";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [SitesModule],
  controllers: [GateController, LiveController, MasterController, DriversController, TelegramController],
  providers: [GatePassesService, GatePassRepository, WeighReadingRepository, MasterDataService, TelegramService, DemoSeedService, GateExcelService, AssistantService]
})
export class GateModule {}
