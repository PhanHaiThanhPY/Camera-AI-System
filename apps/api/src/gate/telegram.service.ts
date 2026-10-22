import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { join } from "node:path";
import { JsonStore } from "./json-store";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
import { buildReport, toPlainText } from "./telegram.report";
import type { BuiltReport } from "./telegram.report";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");

interface StoredConfig {
  botToken: string;
  botUsername: string;
  chatId: string;
  chatTitle: string;
}

export interface PublicConfig {
  configured: boolean;
  hasToken: boolean;
  tokenMasked: string | null;
  botUsername: string | null;
  chatId: string | null;
  chatTitle: string | null;
  timeZone: string;
}

export interface TelegramChat {
  id: string;
  title: string;
  type: string;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface UpdateChat {
  id: number;
  title?: string;
  first_name?: string;
  username?: string;
  type: string;
}

interface Update {
  message?: { chat: UpdateChat };
  channel_post?: { chat: UpdateChat };
  my_chat_member?: { chat: UpdateChat };
}

/** Tích hợp bot Telegram: lưu token + nhóm nhận báo cáo, gửi báo cáo ngày. Token không bao giờ trả về trình duyệt. */
@Injectable()
export class TelegramService {
  private readonly store = new JsonStore<StoredConfig>(join(storageRoot, "telegram-config.json"));
  private readonly apiBase = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  private readonly timeZone = process.env.REPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh";
  private config: StoredConfig;

  public constructor(private readonly gatePasses: GatePassesService) {
    const saved = this.store.load();
    this.config = {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? saved?.botToken ?? "",
      botUsername: saved?.botUsername ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID ?? saved?.chatId ?? "",
      chatTitle: saved?.chatTitle ?? ""
    };
  }

  public getConfig(): PublicConfig {
    const token = this.config.botToken;
    return {
      configured: token !== "" && this.config.chatId !== "",
      hasToken: token !== "",
      tokenMasked: token === "" ? null : `${token.slice(0, 4)}…${token.slice(-4)}`,
      botUsername: this.config.botUsername === "" ? null : this.config.botUsername,
      chatId: this.config.chatId === "" ? null : this.config.chatId,
      chatTitle: this.config.chatTitle === "" ? null : this.config.chatTitle,
      timeZone: this.timeZone
    };
  }

  /** Lưu token (kiểm tra bằng getMe) và/hoặc nhóm nhận báo cáo. */
  public async saveConfig(input: { botToken?: string; chatId?: string; chatTitle?: string }): Promise<PublicConfig> {
    if (input.botToken !== undefined && input.botToken !== "") {
      const token = input.botToken.trim();
      if (!/^\d+:[\w-]{20,}$/.test(token)) {
        throw new BadRequestException("Token không đúng định dạng (dạng 123456789:AAxxxx...). Lấy từ @BotFather.");
      }
      const me = await this.call<{ username?: string }>(token, "getMe");
      this.config = { ...this.config, botToken: token, botUsername: me.username ?? "" };
    }
    if (input.chatId !== undefined) {
      this.config = { ...this.config, chatId: input.chatId.trim(), chatTitle: input.chatTitle?.trim() ?? "" };
    }
    this.store.flush(this.config);
    return this.getConfig();
  }

  /** Trả token đã lưu để người dùng xem lại khi bấm "Hiện". Chỉ gọi theo yêu cầu, không nằm trong cấu hình thường. */
  public revealToken(): { botToken: string } {
    return { botToken: this.config.botToken };
  }

  public clearConfig(): PublicConfig {
    this.config = { botToken: "", botUsername: "", chatId: "", chatTitle: "" };
    this.store.flush(this.config);
    return this.getConfig();
  }

  /** Nhóm mà bot đã nhìn thấy (sau khi bạn add bot vào nhóm và gửi một tin nhắn trong nhóm). */
  public async discoverChats(): Promise<TelegramChat[]> {
    const token = this.requireToken();
    const updates = await this.call<Update[]>(token, "getUpdates", { limit: 100, allowed_updates: ["message", "my_chat_member", "channel_post"] });
    const chats = new Map<string, TelegramChat>();
    for (const update of updates) {
      const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
      if (chat !== undefined) {
        chats.set(String(chat.id), { id: String(chat.id), title: chat.title ?? chat.first_name ?? chat.username ?? String(chat.id), type: chat.type });
      }
    }
    return [...chats.values()];
  }

  public async sendTest(): Promise<void> {
    await this.sendMessages(["✅ <b>Kết nối thành công</b>\nBot đã sẵn sàng gửi báo cáo xe ra vào cho nhóm này."]);
  }

  public preview(date: string): BuiltReport & { plainText: string } {
    const report = this.build(date);
    return { ...report, plainText: toPlainText(report.messages) };
  }

  public async sendReport(date: string): Promise<{ total: number; messages: number }> {
    const report = this.build(date);
    await this.sendMessages(report.messages);
    return { total: report.total, messages: report.messages.length };
  }

  private build(date: string): BuiltReport {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Ngày phải có dạng yyyy-mm-dd.");
    }
    return buildReport(this.gatePasses.listPasses(), { date, timeZone: this.timeZone });
  }

  private async sendMessages(messages: string[]): Promise<void> {
    const token = this.requireToken();
    if (this.config.chatId === "") {
      throw new BadRequestException("Chưa chọn nhóm nhận báo cáo.");
    }
    for (const text of messages) {
      await this.call(token, "sendMessage", { chat_id: this.config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
    }
  }

  private requireToken(): string {
    if (this.config.botToken === "") {
      throw new BadRequestException("Chưa cài token bot Telegram.");
    }
    return this.config.botToken;
  }

  private async call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new BadGatewayException("Không kết nối được tới Telegram. Kiểm tra mạng của máy chủ.");
    }
    const payload = (await response.json().catch(() => null)) as TelegramResponse<T> | null;
    if (payload === null || !payload.ok || payload.result === undefined) {
      throw new BadGatewayException(`Telegram từ chối: ${payload?.description ?? `HTTP ${response.status}`}`);
    }
    return payload.result;
  }
}
