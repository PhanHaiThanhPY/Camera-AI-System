import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
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

@Controller("telegram")
export class TelegramController {
  public constructor(private readonly telegram: TelegramService) {}

  /** Token/Chat ID đọc thẳng từ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID trên máy chủ — không có endpoint lưu/xoá/hiện
   *  token qua giao diện nữa (bảo mật: credential không đi qua trình duyệt hay DB). Sửa .env rồi khởi động lại API. */
  @Get("config")
  public getConfig(): Promise<PublicConfig> {
    return this.telegram.getConfig();
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
