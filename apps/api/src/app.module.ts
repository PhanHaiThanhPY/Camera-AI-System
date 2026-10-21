import { Module } from "@nestjs/common";
import { GateModule } from "./gate/gate.module";
import { VideosModule } from "./videos/videos.module";

@Module({
  imports: [VideosModule, GateModule]
})
export class AppModule {}

