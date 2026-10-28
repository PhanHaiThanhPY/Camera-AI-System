import { Injectable, Logger } from "@nestjs/common";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MasterDataService } from "./master-data.service";
import type { GatePass } from "./gate.types";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_passes_summary",
      description: "Tổng hợp số liệu lượt xe ra/vào trong một ngày: tổng số lượt, tổng khối lượng (kg), số lượt theo trạng thái xử lý.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Ngày yyyy-mm-dd theo giờ Việt Nam. Bỏ trống nghĩa là hôm nay." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_passes",
      description: "Danh sách lượt xe gần đây, có thể lọc theo biển số (gần đúng) hoặc trạng thái xử lý.",
      parameters: {
        type: "object",
        properties: {
          plateNumber: { type: "string", description: "Lọc theo biển số (chứa chuỗi này)." },
          resolution: { type: "string", enum: ["PENDING", "CONFIRMED", "REJECTED"], description: "Lọc theo trạng thái xử lý." },
          limit: { type: "number", description: "Tối đa bao nhiêu lượt trả về, mặc định 10, tối đa 30." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_vehicles",
      description: "Danh sách xe trong master data (tất cả đối tác), kèm tài xế đang gắn với từng xe.",
      parameters: {
        type: "object",
        properties: {
          plateNumber: { type: "string", description: "Lọc theo biển số (chứa chuỗi này)." }
        }
      }
    }
  }
] as const;

const SYSTEM_PROMPT =
  "Bạn là trợ lý vận hành trạm cân xe của hệ thống Camera AI System, trả lời bằng tiếng Việt, ngắn gọn, đi thẳng vào số liệu. " +
  "CHỈ dùng dữ liệu lấy được từ các tool được cung cấp — tuyệt đối không tự bịa số liệu. " +
  "Nếu tool không trả về gì liên quan tới câu hỏi, nói rõ là không tìm thấy, không suy đoán thêm.";

const MAX_TOOL_ROUNDS = 4;
/** Giữ system + tối đa bấy nhiêu message gần nhất mỗi chat, tránh lịch sử phình to vô hạn theo thời gian. */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Cầu nối Telegram ↔ DeepSeek ↔ dữ liệu nghiệp vụ. DeepSeek chỉ là API chat văn bản, không có cách nào tự
 * kết nối vào Postgres của mình — và cũng không nên cho một API key của bên thứ ba quyền đó. Vì vậy mọi câu
 * hỏi đi qua một vòng "tool calling" chuẩn OpenAI-compatible: gửi câu hỏi + danh sách tool (hàm) kèm mô tả
 * cho DeepSeek, nếu nó cần dữ liệu thì trả về yêu cầu gọi tool (không tự lấy được), SERVER này mới là nơi
 * thực sự chạy hàm đó trên dữ liệu thật rồi đưa kết quả về cho DeepSeek viết câu trả lời cuối cùng.
 * Lịch sử hội thoại giữ theo từng chatId (bộ nhớ, mất khi restart) — /reset ở TelegramService xoá thủ công.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly history = new Map<string, ChatMessage[]>();

  public constructor(
    private readonly passes: GatePassesService,
    private readonly master: MasterDataService
  ) {}

  /** true khi đã đặt DEEPSEEK_API_KEY — TelegramService dùng để quyết có xử lý tin nhắn tự do hay không. */
  public get enabled(): boolean {
    return (process.env.DEEPSEEK_API_KEY ?? "") !== "";
  }

  public reset(chatId: string): void {
    this.history.delete(chatId);
  }

  public async ask(chatId: string, question: string): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
    if (apiKey === "") {
      return "Chưa cấu hình DEEPSEEK_API_KEY trên máy chủ.";
    }
    const conversation = this.history.get(chatId) ?? [{ role: "system", content: SYSTEM_PROMPT }];
    conversation.push({ role: "user", content: question });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const message = await this.callDeepSeek(apiKey, conversation);
      conversation.push(message);
      if (message.tool_calls === undefined || message.tool_calls.length === 0) {
        this.history.set(chatId, trimHistory(conversation));
        return message.content;
      }
      for (const call of message.tool_calls) {
        const result = await this.runTool(call.function.name, safeParseArgs(call.function.arguments));
        conversation.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
      }
    }
    this.history.set(chatId, trimHistory(conversation));
    return "Câu hỏi này cần quá nhiều bước để trả lời — thử hỏi cụ thể hơn (ví dụ theo ngày hoặc theo biển số).";
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case "get_passes_summary":
          return await this.toolPassesSummary(typeof args.date === "string" ? args.date : undefined);
        case "list_passes":
          return await this.toolListPasses(args);
        case "list_vehicles":
          return this.toolListVehicles(typeof args.plateNumber === "string" ? args.plateNumber : undefined);
        default:
          return { error: `Không có tool "${name}".` };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Lỗi không xác định." };
    }
  }

  private async toolPassesSummary(date?: string): Promise<unknown> {
    const all = await this.passes.listPasses({ allSites: true });
    const day = date ?? localDate(new Date());
    const inDay = all.filter((pass) => localDate(new Date(pass.capture.capturedAt)) === day);
    const totalNetKg = inDay.reduce((sum, pass) => sum + (pass.weighing?.netKg ?? 0), 0);
    const byResolution: Record<GatePass["resolution"], number> = { PENDING: 0, CONFIRMED: 0, REJECTED: 0 };
    for (const pass of inDay) {
      byResolution[pass.resolution] += 1;
    }
    return { ngay: day, tongLuot: inDay.length, tongNetKg: totalNetKg, theoXuLy: byResolution };
  }

  private async toolListPasses(args: Record<string, unknown>): Promise<unknown> {
    const all = await this.passes.listPasses({ allSites: true });
    const plateFilter = typeof args.plateNumber === "string" ? args.plateNumber.trim().toLowerCase() : undefined;
    const resolutionFilter = typeof args.resolution === "string" ? args.resolution : undefined;
    const limit = typeof args.limit === "number" ? Math.min(Math.max(1, Math.trunc(args.limit)), 30) : 10;
    const filtered = all
      .filter((pass) => plateFilter === undefined || plateFilter === "" || pass.effective.plateNumber.toLowerCase().includes(plateFilter))
      .filter((pass) => resolutionFilter === undefined || pass.resolution === resolutionFilter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return {
      total: filtered.length,
      items: filtered.map((pass) => ({
        bienSo: pass.effective.plateNumber,
        loaiXe: pass.effective.vehicleType,
        vatLieu: pass.effective.material,
        trangThai: pass.status,
        xuLy: pass.resolution,
        netKg: pass.weighing?.netKg ?? null,
        vaoLuc: pass.capture.capturedAt,
        raLuc: pass.exitCapture?.capturedAt ?? null
      }))
    };
  }

  private toolListVehicles(plateNumber?: string): unknown {
    const all = this.master.listAllVehiclesAcrossOwners();
    const filter = plateNumber?.trim().toLowerCase();
    const filtered = filter === undefined || filter === "" ? all : all.filter((vehicle) => vehicle.plateNumber.toLowerCase().includes(filter));
    return {
      total: filtered.length,
      items: filtered.slice(0, 30).map((vehicle) => ({
        bienSo: vehicle.plateNumber,
        loaiXe: vehicle.vehicleType,
        ghiChu: vehicle.note,
        taiXe: vehicle.drivers.map((driver) => ({ hoTen: driver.fullName, soDienThoai: driver.phone, laTaiXeChinh: driver.isPrimary }))
      }))
    };
  }

  private async callDeepSeek(apiKey: string, messages: ChatMessage[]): Promise<ChatMessage> {
    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    const base = process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com";
    let response: Response;
    try {
      response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto" }),
        signal: AbortSignal.timeout(30_000)
      });
    } catch {
      throw new Error("Không kết nối được tới DeepSeek. Kiểm tra mạng của máy chủ.");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(`deepseek rejected HTTP ${response.status}: ${body.slice(0, 200)}`);
      throw new Error(`DeepSeek từ chối yêu cầu (HTTP ${response.status}).`);
    }
    const payload = (await response.json()) as { choices?: { message?: ChatMessage }[] };
    const message = payload.choices?.[0]?.message;
    if (message === undefined) {
      throw new Error("DeepSeek không trả về câu trả lời.");
    }
    return message;
  }
}

function localDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.REPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function trimHistory(conversation: ChatMessage[]): ChatMessage[] {
  if (conversation.length <= MAX_HISTORY_MESSAGES + 1) {
    return conversation;
  }
  return [conversation[0], ...conversation.slice(-MAX_HISTORY_MESSAGES)];
}
