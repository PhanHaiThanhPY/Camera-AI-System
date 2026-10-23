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

/** Only explicitly configured local UI origins may request the Telegram token. */
function assertTrustedOrigin(origin: string | undefined): void {
  if (origin === undefined) {
    throw new ForbiddenException("Thiếu Origin của giao diện được phép.");
  }
  const allowed = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (!allowed.includes(origin)) {
    throw new ForbiddenException("Không được phép xem token từ nguồn này.");
  }
}

@Controller("telegram")
export class TelegramController {
  public constructor(private readonly telegram: TelegramService) {}

  @Get("config")
  public getConfig(): Promise<PublicConfig> {
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
  public revealToken(@Headers("origin") origin: string | undefined): Promise<{ botToken: string }> {
    assertTrustedOrigin(origin);
    return this.telegram.revealToken();
  }

  @Delete("config")
  public clearConfig(): Promise<PublicConfig> {
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
