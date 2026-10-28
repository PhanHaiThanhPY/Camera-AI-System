import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator";
import { isDemoMode } from "./config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "./prisma/prisma.service";

const STARTED_AT = Date.now();

interface HealthResponse {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  memory: { rssMb: number; heapUsedMb: number };
  /** "disabled" = DEMO_MODE=true, API không kết nối Postgres (xem config/demo-mode.ts). */
  database: "ok" | "error" | "disabled";
}

/** Đo tải cơ bản của apps/api — dùng để kiểm tra nhanh (scripts/measure.sh) hoặc giám sát bên ngoài. */
@Controller("health")
export class HealthController {
  public constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  public async check(): Promise<HealthResponse> {
    const memory = process.memoryUsage();
    let database: "ok" | "error" | "disabled" = "ok";
    if (isDemoMode()) {
      database = "disabled";
    } else {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
      } catch {
        database = "error";
      }
    }
    return {
      status: database === "error" ? "degraded" : "ok",
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024)
      },
      database
    };
  }
}
