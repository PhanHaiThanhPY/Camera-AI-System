import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Post, Put, Query } from "@nestjs/common";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TelegramService } from "./telegram.service";
import type { PublicConfig, TelegramChat } from "./telegram.service";

type JsonBody = Record<string, unknown> | undefined;

function optionalText(body: JsonBody, key: string): string | undefined {
  const value = body?.[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} phải là chuỗi.`);
  }
  return value;
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** Chỉ cho trang chạy trên máy/mạng nội bộ đọc token; chặn website bên ngoài gọi chéo vào API local. */
function assertTrustedOrigin(origin: string | undefined): void {
  if (origin === undefined) {
    return;
  }
  const extra = (process.env.CORS_ORIGINS ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    throw new ForbiddenException("Origin không hợp lệ.");
  }
  if (!PRIVATE_HOST.test(host) && !extra.includes(origin)) {
    throw new ForbiddenException("Không được phép xem token từ nguồn này.");
  }
}

@Controller("telegram")
export class TelegramController {
  public constructor(private readonly telegram: TelegramService) {}

  @Get("config")
  public getConfig(): PublicConfig {
    return this.telegram.getConfig();
  }

  @Put("config")
  public saveConfig(@Body() body: JsonBody): Promise<PublicConfig> {
    const input: { botToken?: string; chatId?: string; chatTitle?: string } = {};
    const botToken = optionalText(body, "botToken");
    const chatId = optionalText(body, "chatId");
    const chatTitle = optionalText(body, "chatTitle");
    if (botToken !== undefined) {
      input.botToken = botToken;
    }
    if (chatId !== undefined) {
      input.chatId = chatId;
    }
    if (chatTitle !== undefined) {
      input.chatTitle = chatTitle;
    }
    return this.telegram.saveConfig(input);
  }

  @Post("token/reveal")
  @HttpCode(200)
  public revealToken(@Headers("origin") origin: string | undefined): { botToken: string } {
    assertTrustedOrigin(origin);
    return this.telegram.revealToken();
  }

  @Delete("config")
  public clearConfig(): PublicConfig {
    return this.telegram.clearConfig();
  }

  @Get("chats")
  public chats(): Promise<TelegramChat[]> {
    return this.telegram.discoverChats();
  }

  @Post("test")
  @HttpCode(200)
  public async test(): Promise<{ ok: true }> {
    await this.telegram.sendTest();
    return { ok: true };
  }

  @Get("report/preview")
  public preview(@Query("date") date: string | undefined): ReturnType<TelegramService["preview"]> {
    return this.telegram.preview(date ?? "");
  }

  @Post("report")
  @HttpCode(200)
  public sendReport(@Body() body: JsonBody): Promise<{ total: number; messages: number }> {
    return this.telegram.sendReport(optionalText(body, "date") ?? "");
  }
}
