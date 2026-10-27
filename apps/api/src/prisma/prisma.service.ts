import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { isDemoMode } from "../config/demo-mode";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL chưa được cấu hình. Xem .env.example và docker-compose.yml.");
  }
  return url;
}

/**
 * PrismaClient dùng driver adapter pg (bắt buộc từ Prisma 7, schema.prisma không còn khai báo url).
 * DEMO_MODE=true: không yêu cầu DATABASE_URL và không mở kết nối thật — toàn bộ nghiệp vụ lúc đó đọc/ghi
 * bộ nhớ trong (xem GatePassRepository, WeighReadingRepository, MasterDataService, TelegramService).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  public constructor() {
    const connectionString = isDemoMode() ? (process.env.DATABASE_URL ?? "postgresql://demo:demo@localhost:5432/demo") : requireDatabaseUrl();
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  public async onModuleInit(): Promise<void> {
    if (isDemoMode()) {
      this.logger.log("DEMO_MODE=true — bỏ qua kết nối PostgreSQL, API chạy với dữ liệu mẫu.");
      return;
    }
    await this.$connect();
    this.logger.log("Đã kết nối PostgreSQL.");
  }

  public async onModuleDestroy(): Promise<void> {
    if (isDemoMode()) {
      return;
    }
    await this.$disconnect();
  }
}
