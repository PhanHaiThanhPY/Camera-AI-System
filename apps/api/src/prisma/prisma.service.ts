import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL chưa được cấu hình. Xem .env.example và docker-compose.yml.");
  }
  return url;
}

/** PrismaClient dùng driver adapter pg (bắt buộc từ Prisma 7, schema.prisma không còn khai báo url). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  public constructor() {
    super({ adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }) });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Đã kết nối PostgreSQL.");
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
