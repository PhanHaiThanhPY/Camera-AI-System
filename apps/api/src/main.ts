import { NestFactory } from "@nestjs/core";
import express from "express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

  app.enableCors({ origin: corsOrigins });
  app.setGlobalPrefix("api");
  app.use("/storage", express.static(storageRoot));

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen(port, host);
}

void bootstrap();

