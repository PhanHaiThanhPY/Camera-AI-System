import type { OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { isDemoMode } from "../config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "../sites/sites.service";
import { DEMO_LEGS } from "./demo-data";
import { placeholderCaptureImage } from "./gate.mock";
import type { CaptureShot } from "./gate.types";

/** Lặp lại shot mẫu cho đủ CAPTURE_EXPECTED_SHOTS (mỗi bản dựng lại ảnh theo đúng góc camera 0..3 — trước/
 *  sau/trái/phải, xem placeholderCaptureImage) để chốt ngay, không phải chờ hết CAPTURE_TIMEOUT_SECONDS. */
function padShots(shots: CaptureShot[] | undefined, expected: number): CaptureShot[] | undefined {
  if (shots === undefined) {
    return undefined;
  }
  return Array.from({ length: expected }, (_, index) => {
    const base = shots[index % shots.length];
    if (base.imageUrl === null || base.imageUrl === undefined) {
      return { ...base, cameraId: `CAM-SIM-${index + 1}` };
    }
    const { cameraId, imageUrl } = placeholderCaptureImage(index, base.plateNumber ?? "?", base.quality);
    return { ...base, cameraId, imageUrl };
  });
}

/**
 * DEMO_MODE=true: dựng sẵn một lô lượt xe mẫu đi qua đúng luồng cân-trước-chụp-sau thật (simulateWeighAndCapture/
 * resolve — xem GatePassesService, cũng là nền của nút "Mô phỏng cân + chụp" ở dashboard), để dashboard có nội
 * dung ngay khi chưa nối camera/cân thật. Không đụng Postgres: GatePassRepository/WeighReadingRepository/
 * MasterDataService tự rẽ sang bộ nhớ trong khi DEMO_MODE=true (xem các file đó).
 */
@Injectable()
export class DemoSeedService implements OnModuleInit {
  private readonly logger = new Logger(DemoSeedService.name);

  public constructor(
    private readonly gatePasses: GatePassesService,
    private readonly sites: SitesService
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!isDemoMode()) {
      return;
    }
    const site = this.sites.anySite();
    if (site === undefined) {
      this.logger.warn("demo-seed: chưa có cơ sở demo nào (UsersService chưa tạo xong?) — bỏ qua dựng dữ liệu mẫu.");
      return;
    }
    const expected = Math.max(1, Number(process.env.CAPTURE_EXPECTED_SHOTS ?? 4));
    let legCount = 0;
    // Một kịch bản mẫu lỗi không nên chặn cả API khởi động — log rồi bỏ qua, chạy tiếp các xe còn lại.
    // scaleId trong demo-data.ts (SCALE-01..04) chỉ để phân biệt NHIỀU trạm cân trong dữ liệu mẫu cũ —
    // giờ 1 scaleId = 1 Site thật, nên gán hết về đúng scaleId của site demo đã tạo (dồn về 1 trạm).
    for (const vehicleLegs of DEMO_LEGS) {
      try {
        for (const leg of vehicleLegs) {
          legCount += 1;
          const pass = await this.gatePasses.simulateWeighAndCapture({ ...leg.options, scaleId: site.scaleId, shots: padShots(leg.options.shots, expected) });
          if (leg.resolve !== undefined) {
            await this.gatePasses.resolve(pass.id, leg.resolve.decision, { actor: "demo-seed", reason: leg.resolve.reason, overrides: {} }, { allSites: true });
          }
        }
      } catch (error: unknown) {
        this.logger.warn(`demo-seed: bỏ qua 1 kịch bản mẫu lỗi (${error instanceof Error ? error.message : "unknown"})`);
      }
    }
    this.logger.log(`DEMO_MODE=true — đã dựng ${DEMO_LEGS.length} lượt xe mẫu (${legCount} lần cân) qua đúng luồng cân-trước-chụp-sau.`);
  }
}
