import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: Migrate/Studio lấy connection string từ đây (schema.prisma không còn khai báo `url`).
// PrismaClient lúc chạy app dùng driver adapter riêng — xem apps/api/src/prisma/prisma.service.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL")
  }
});
