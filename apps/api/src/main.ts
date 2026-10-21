import { NestFactory } from "@nestjs/core";
import express from "express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");

  app.enableCors();
  app.setGlobalPrefix("api");
  app.use("/storage", express.static(storageRoot));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();

