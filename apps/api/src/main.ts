// Phải là import đầu tiên: nạp .env trước khi bất kỳ module nào khác đọc process.env ở top-level.
import "dotenv/config";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

  app.use(cookieParser());
  // credentials: true — bắt buộc để trình duyệt gửi/nhận cookie đăng nhập (cas_session) qua CORS.
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen(port, host);
}

void bootstrap();

