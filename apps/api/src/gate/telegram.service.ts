import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassRepository } from "./gate-pass.repository";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AssistantService } from "./assistant.service";
import { buildReport, toPlainText } from "./telegram.report";
import type { BuiltReport } from "./telegram.report";

interface EnvConfig {
  botToken: string;
  chatId: string;
}

export interface PublicConfig {
  configured: boolean;
  hasToken: boolean;
  botUsername: string | null;
  chatId: string | null;
  chatTitle: string | null;
  timeZone: string;
  /** true khi DEEPSEEK_API_KEY đã đặt trên máy chủ — trợ lý AI trong Telegram sẵn sàng trả lời câu hỏi tự do. */
  assistantEnabled: boolean;
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
  update_id: number;
  message?: { chat: UpdateChat; text?: string };
  channel_post?: { chat: UpdateChat };
  my_chat_member?: { chat: UpdateChat };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tích hợp bot Telegram: token + nhóm nhận báo cáo đọc thẳng từ biến môi trường (TELEGRAM_BOT_TOKEN/
 * TELEGRAM_CHAT_ID) — không nhập/lưu qua giao diện hay Postgres nữa (bảo mật: credential không đi qua
 * trình duyệt hay nằm trong DB). Gửi báo cáo ngày, và chạy vòng long-poll nền để nhận tin nhắn — admin
 * chat trực tiếp với bot, câu hỏi tự do được chuyển cho AssistantService (DeepSeek) trả lời dựa trên dữ
 * liệu thật của hệ thống.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly apiBase = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  private readonly timeZone = process.env.REPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh";
  private readonly allowedChatIds = (process.env.TELEGRAM_ASSISTANT_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  /** Nhóm/chat bot đã nhìn thấy qua vòng long-poll — thay cho việc gọi getUpdates riêng mỗi lần bấm "Tìm nhóm". */
  private readonly seenChats = new Map<string, TelegramChat>();
  /** @username của bot, lấy 1 lần qua getMe rồi nhớ trong tiến trình — chỉ hiển thị, không phải credential. */
  private botUsername: string | null = null;
  private offset = 0;
  private stopped = false;

  public constructor(
    private readonly passes: GatePassRepository,
    private readonly assistant: AssistantService
  ) {}

  public onModuleInit(): void {
    void this.pollLoop();
  }

  public onModuleDestroy(): void {
    this.stopped = true;
  }

  public async getConfig(): Promise<PublicConfig> {
    const config = this.envConfig();
    if (config.botToken !== "" && this.botUsername === null) {
      this.botUsername = await this.call<{ username?: string }>(config.botToken, "getMe")
        .then((me) => me.username ?? null)
        .catch(() => null);
    }
    return {
      configured: config.botToken !== "" && config.chatId !== "",
      hasToken: config.botToken !== "",
      botUsername: this.botUsername,
      chatId: config.chatId === "" ? null : config.chatId,
      chatTitle: config.chatId === "" ? null : (this.seenChats.get(config.chatId)?.title ?? null),
      timeZone: this.timeZone,
      assistantEnabled: this.assistant.configured
    };
  }

  /** Nhóm/chat bot đã nhìn thấy (sau khi bạn add bot vào nhóm và gửi một tin nhắn) — chỉ để tra Chat ID dán vào .env. */
  public async discoverChats(): Promise<TelegramChat[]> {
    const token = this.requireToken();
    // Đồng bộ ngay một nhịp (không chờ lâu) để gộp tin vừa tới trước khi trả về, dùng chung offset với vòng poll nền.
    await this.pollOnce(token, 0);
    return [...this.seenChats.values()];
  }

  /** Vòng long-poll nền: chờ token được cấu hình, rồi liên tục getUpdates để nhận tin nhắn admin gửi cho bot. */
  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      const config = this.envConfig();
      if (config.botToken === "") {
        await delay(3_000);
        continue;
      }
      try {
        await this.pollOnce(config.botToken, 25);
      } catch (error: unknown) {
        this.logger.warn(`telegram poll failed: ${error instanceof Error ? error.message : "unknown"}`);
        await delay(5_000);
      }
    }
  }

  /** Một nhịp getUpdates: cập nhật offset + seenChats, và chuyển tin nhắn văn bản cho handleIncomingMessage. */
  private async pollOnce(token: string, timeoutSeconds: number): Promise<void> {
    const updates = await this.call<Update[]>(token, "getUpdates", {
      offset: this.offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message", "my_chat_member", "channel_post"]
    });
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
      if (chat !== undefined) {
        this.seenChats.set(String(chat.id), { id: String(chat.id), title: chat.title ?? chat.first_name ?? chat.username ?? String(chat.id), type: chat.type });
      }
      const text = update.message?.text;
      if (text !== undefined && chat !== undefined) {
        void this.handleIncomingMessage(token, String(chat.id), text);
      }
    }
  }

  /** Tin nhắn admin gửi trực tiếp cho bot: /start, /reset, hoặc câu hỏi tự do chuyển cho trợ lý AI. */
  private async handleIncomingMessage(token: string, chatId: string, text: string): Promise<void> {
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed === "/start") {
      await this.call(token, "sendMessage", {
        chat_id: chatId,
        text: "Xin chào, tôi là trợ lý AI của hệ thống kiểm soát xe & vật liệu.\nHỏi tôi bất cứ điều gì về dữ liệu hệ thống, ví dụ: \"hôm nay có bao nhiêu xe vào ra\", \"tổng khối lượng hàng tuần này\", \"xe 51C-12345 của ai lái\".\nGửi /reset để bắt đầu lại cuộc trò chuyện."
      });
      return;
    }
    if (trimmed === "/reset") {
      this.assistant.resetHistory(chatId);
      await this.call(token, "sendMessage", { chat_id: chatId, text: "Đã xoá ngữ cảnh hội thoại cũ." });
      return;
    }
    if (trimmed === "") {
      return;
    }
    await this.call(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    const reply = await this.assistant.reply(chatId, trimmed);
    await this.call(token, "sendMessage", { chat_id: chatId, text: reply }).catch((error: unknown) => {
      this.logger.warn(`failed to send assistant reply: ${error instanceof Error ? error.message : "unknown"}`);
    });
  }

  public async sendTest(): Promise<void> {
    await this.sendMessages(["✅ <b>Kết nối thành công</b>\nBot đã sẵn sàng gửi báo cáo xe ra vào cho nhóm này."]);
  }

  public async preview(date: string): Promise<BuiltReport & { plainText: string }> {
    const report = await this.build(date);
    return { ...report, plainText: toPlainText(report.messages) };
  }

  public async sendReport(date: string): Promise<{ total: number; messages: number }> {
    const report = await this.build(date);
    await this.sendMessages(report.messages);
    return { total: report.total, messages: report.messages.length };
  }

  private async build(date: string): Promise<BuiltReport> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Ngày phải có dạng yyyy-mm-dd.");
    }
    // Lấy rộng hơn 1 ngày theo giờ UTC ở mỗi phía để chắc chắn phủ hết ngày `date` ở múi giờ báo cáo,
    // rồi buildReport tự lọc chính xác theo múi giờ — tránh phải quét toàn bộ lịch sử cho một báo cáo.
    const from = new Date(`${date}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(`${date}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 2);
    const candidates = await this.passes.listByCapturedRange(from, to);
    return buildReport(candidates, { date, timeZone: this.timeZone });
  }

  private async sendMessages(messages: string[]): Promise<void> {
    const token = this.requireToken();
    const config = this.envConfig();
    if (config.chatId === "") {
      throw new BadRequestException("Chưa đặt TELEGRAM_CHAT_ID trên máy chủ.");
    }
    for (const text of messages) {
      await this.call(token, "sendMessage", { chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
    }
  }

  private requireToken(): string {
    const { botToken } = this.envConfig();
    if (botToken === "") {
      throw new BadRequestException("Chưa đặt TELEGRAM_BOT_TOKEN trên máy chủ.");
    }
    return botToken;
  }

  private envConfig(): EnvConfig {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID ?? ""
    };
  }

  private async call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    // getUpdates long-poll có thể giữ kết nối tới `timeout` giây (Telegram chờ có tin mới mới trả lời) — HTTP timeout
    // phải dài hơn con số đó, không thì mỗi nhịp không có tin mới sẽ bị abort và báo lỗi giả.
    const requestTimeoutMs = method === "getUpdates" ? (Number(body?.timeout ?? 0) + 10) * 1_000 : 15_000;
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(Math.max(requestTimeoutMs, 15_000))
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
