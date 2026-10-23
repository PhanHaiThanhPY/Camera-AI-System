import { Injectable, Logger } from "@nestjs/common";
import { MATERIALS, VEHICLE_PROFILES } from "./gate.catalog";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassRepository } from "./gate-pass.repository";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MasterDataService } from "./master-data.service";
import { dateInZone } from "./telegram.report";
import type { GatePass, Resolution, VerificationStatus } from "./gate.types";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_TURNS = 8;

const MATERIAL_LABEL = new Map(MATERIALS.map((item) => [item.code, item.label]));
const VEHICLE_LABEL = new Map(VEHICLE_PROFILES.map((item) => [item.code, item.label]));
const labelOf = (map: Map<string, string>, code: string | null): string => (code === null ? "Chưa xác định" : (map.get(code) ?? code));

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: string;
}

const TOOLS = [
  {
    name: "get_passes_summary",
    description:
      "Tổng hợp số lượt xe, khối lượng hàng, trạng thái kiểm tra chéo và quyết định xử lý trong một khoảng ngày (theo múi giờ báo cáo của hệ thống). Dùng cho câu hỏi kiểu 'hôm nay có bao nhiêu xe', 'tổng khối lượng tuần này', 'bao nhiêu lượt cần xem lại'.",
    input_schema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Ngày bắt đầu, dạng yyyy-mm-dd." },
        toDate: { type: "string", description: "Ngày kết thúc (bao gồm), dạng yyyy-mm-dd. Bằng fromDate nếu chỉ hỏi một ngày." }
      },
      required: ["fromDate", "toDate"]
    }
  },
  {
    name: "list_passes",
    description:
      "Danh sách chi tiết từng lượt xe trong khoảng ngày, lọc được theo trạng thái kiểm tra chéo hoặc quyết định xử lý. Dùng khi cần liệt kê cụ thể (xe nào chưa xử lý, xe nào không khớp, biển số và giờ vào/ra).",
    input_schema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Ngày bắt đầu, dạng yyyy-mm-dd." },
        toDate: { type: "string", description: "Ngày kết thúc (bao gồm), dạng yyyy-mm-dd." },
        status: { type: "string", enum: ["VERIFIED", "REVIEW_REQUIRED", "MISMATCH", "NOT_IN_YARD", "WAITING_SECOND_WEIGH", "WAITING_WEIGHT"], description: "Lọc theo trạng thái kiểm tra chéo (tuỳ chọn)." },
        resolution: { type: "string", enum: ["PENDING", "CONFIRMED", "REJECTED"], description: "Lọc theo quyết định người vận hành (tuỳ chọn)." },
        limit: { type: "number", description: "Số dòng tối đa trả về, mặc định 50, tối đa 200." }
      },
      required: ["fromDate", "toDate"]
    }
  },
  {
    name: "list_vehicles",
    description: "Danh mục xe và tài xế đã đăng ký trong bãi (master data). Dùng khi hỏi về một xe/tài xế cụ thể, hoặc tổng số xe đã đăng ký.",
    input_schema: {
      type: "object",
      properties: { search: { type: "string", description: "Lọc theo biển số hoặc tên tài xế chứa chuỗi này (tuỳ chọn, không phân biệt hoa thường)." } }
    }
  }
] as const;

function systemPrompt(timeZone: string): string {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return [
    "Bạn là trợ lý phân tích dữ liệu cho hệ thống kiểm soát xe & vật liệu tại một mỏ đá (Camera AI System).",
    `Thời điểm hiện tại: ${now} (múi giờ ${timeZone}). Dùng để tính 'hôm nay', 'hôm qua', 'tuần này' thành ngày yyyy-mm-dd cụ thể khi gọi công cụ.`,
    "Luôn gọi công cụ để lấy số liệu thật trước khi trả lời câu hỏi về dữ liệu — không tự bịa số.",
    "Trả lời ngắn gọn, rõ ràng bằng tiếng Việt, phù hợp để đọc trong một tin nhắn Telegram. Không dùng cú pháp Markdown (không **, không #, không bảng) vì tin nhắn gửi dạng chữ thường; dùng gạch đầu dòng bằng ký tự • hoặc số thứ tự nếu cần liệt kê, và có thể dùng emoji vừa phải cho dễ đọc.",
    "Nếu câu hỏi không liên quan tới hệ thống xe/vật liệu/mỏ đá, trả lời ngắn rằng bạn chỉ hỗ trợ hỏi đáp về dữ liệu hệ thống này."
  ].join("\n");
}

/** Trợ lý AI (Claude) trả lời câu hỏi tự do về dữ liệu hệ thống, dùng trong Telegram — xem TelegramService. */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly timeZone = process.env.REPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh";
  private readonly history = new Map<string, ClaudeMessage[]>();

  public constructor(
    private readonly passes: GatePassRepository,
    private readonly master: MasterDataService
  ) {}

  public get configured(): boolean {
    return (process.env.ANTHROPIC_API_KEY ?? "") !== "";
  }

  public resetHistory(sessionId: string): void {
    this.history.delete(sessionId);
  }

  /** Trả lời một câu hỏi trong phiên `sessionId` (một chat Telegram); giữ vài lượt hội thoại gần nhất làm ngữ cảnh. */
  public async reply(sessionId: string, userText: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (apiKey === "") {
      return "Trợ lý AI chưa được cấu hình (thiếu ANTHROPIC_API_KEY trên máy chủ). Báo quản trị viên đặt biến môi trường này rồi khởi động lại API.";
    }

    const priorTurns = this.history.get(sessionId) ?? [];
    const messages: ClaudeMessage[] = [...priorTurns, { role: "user", content: userText }];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const response = await this.callClaude(apiKey, messages);
        if (response.stop_reason !== "tool_use") {
          const text = response.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
          const finalText = text === "" ? "Xin lỗi, tôi chưa có câu trả lời phù hợp cho câu hỏi này." : text;
          this.saveTurn(sessionId, userText, finalText);
          return finalText;
        }

        const toolUses = response.content.filter((block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => block.type === "tool_use");
        const toolResults: ContentBlock[] = [];
        for (const toolUse of toolUses) {
          const result = await this.runTool(toolUse.name, toolUse.input);
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) });
        }
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
      }
      return "Câu hỏi này cần tra cứu quá nhiều bước, bạn hỏi cụ thể hơn giúp tôi nhé (ví dụ thu hẹp theo ngày).";
    } catch (error: unknown) {
      this.logger.error("assistant reply failed", error instanceof Error ? error.stack : undefined);
      return "Có lỗi khi gọi trợ lý AI, thử lại sau ít phút giúp tôi.";
    }
  }

  private saveTurn(sessionId: string, userText: string, assistantText: string): void {
    const turns = this.history.get(sessionId) ?? [];
    turns.push({ role: "user", content: userText }, { role: "assistant", content: assistantText });
    this.history.set(sessionId, turns.slice(-MAX_HISTORY_TURNS * 2));
  }

  private async callClaude(apiKey: string, messages: ClaudeMessage[]): Promise<ClaudeResponse> {
    const response = await fetch(ANTHROPIC_API_BASE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 1024,
        system: systemPrompt(this.timeZone),
        tools: TOOLS,
        messages
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const payload = (await response.json().catch(() => null)) as (ClaudeResponse & { error?: { message?: string } }) | null;
    if (!response.ok || payload === null) {
      throw new Error(`Claude API lỗi: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
    }
    return payload;
  }

  private async runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case "get_passes_summary":
          return await this.toolGetPassesSummary(input);
        case "list_passes":
          return await this.toolListPasses(input);
        case "list_vehicles":
          return this.toolListVehicles(input);
        default:
          return { error: `Không có công cụ tên ${name}.` };
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : "Lỗi không xác định khi tra cứu dữ liệu." };
    }
  }

  /** Lượt có capturedAt rơi vào [fromDate, toDate] (bao gồm cả hai đầu) theo múi giờ báo cáo. */
  private async passesInRange(fromDate: string, toDate: string): Promise<GatePass[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new Error("fromDate/toDate phải có dạng yyyy-mm-dd.");
    }
    const from = new Date(`${fromDate}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(`${toDate}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 2);
    const candidates = await this.passes.listByCapturedRange(from, to);
    return candidates.filter((pass) => {
      const day = dateInZone(pass.capture.capturedAt, this.timeZone);
      return day >= fromDate && day <= toDate;
    });
  }

  private async toolGetPassesSummary(input: Record<string, unknown>): Promise<unknown> {
    const fromDate = String(input.fromDate ?? "");
    const toDate = String(input.toDate ?? "");
    const passes = await this.passesInRange(fromDate, toDate);
    const byStatus: Partial<Record<VerificationStatus, number>> = {};
    const byResolution: Partial<Record<Resolution, number>> = {};
    const byMaterial: Record<string, { trips: number; netKg: number }> = {};
    let totalNetKg = 0;
    let entered = 0;
    let exited = 0;
    for (const pass of passes) {
      byStatus[pass.status] = (byStatus[pass.status] ?? 0) + 1;
      byResolution[pass.resolution] = (byResolution[pass.resolution] ?? 0) + 1;
      const materialLabel = labelOf(MATERIAL_LABEL, pass.effective.material);
      const entry = byMaterial[materialLabel] ?? { trips: 0, netKg: 0 };
      entry.trips += 1;
      entry.netKg += pass.weighing?.netKg ?? 0;
      byMaterial[materialLabel] = entry;
      totalNetKg += pass.weighing?.netKg ?? 0;
      if (pass.visitStatus === "EXITED") {
        exited += 1;
      } else {
        entered += 1;
      }
    }
    return {
      fromDate,
      toDate,
      totalTrips: passes.length,
      totalNetKg,
      totalNetTons: Math.round((totalNetKg / 1000) * 100) / 100,
      xeDangTrongBai: entered,
      xeDaRaKhoiBai: exited,
      theoTrangThaiKiemTra: byStatus,
      theoQuyetDinhXuLy: byResolution,
      theoLoaiVatLieu: byMaterial
    };
  }

  private async toolListPasses(input: Record<string, unknown>): Promise<unknown> {
    const fromDate = String(input.fromDate ?? "");
    const toDate = String(input.toDate ?? "");
    const status = typeof input.status === "string" ? (input.status as VerificationStatus) : undefined;
    const resolution = typeof input.resolution === "string" ? (input.resolution as Resolution) : undefined;
    const limit = Math.min(typeof input.limit === "number" ? input.limit : 50, 200);
    let passes = await this.passesInRange(fromDate, toDate);
    if (status !== undefined) {
      passes = passes.filter((pass) => pass.status === status);
    }
    if (resolution !== undefined) {
      passes = passes.filter((pass) => pass.resolution === resolution);
    }
    const total = passes.length;
    const items = passes.slice(0, limit).map((pass) => ({
      bienSo: pass.effective.plateNumber,
      thoiGian: pass.capture.capturedAt,
      loaiXe: labelOf(VEHICLE_LABEL, pass.effective.vehicleType),
      vatLieu: labelOf(MATERIAL_LABEL, pass.effective.material),
      hangKg: pass.weighing?.netKg ?? null,
      trangThaiKiemTra: pass.status,
      quyetDinh: pass.resolution,
      lyDo: pass.statusReasons.join("; ") || null
    }));
    return { total, traVe: items.length, items };
  }

  private toolListVehicles(input: Record<string, unknown>): unknown {
    const search = typeof input.search === "string" ? input.search.trim().toLowerCase() : "";
    const vehicles = this.master.listVehicles();
    const filtered = search === "" ? vehicles : vehicles.filter((vehicle) => vehicle.plateNumber.toLowerCase().includes(search) || vehicle.drivers.some((driver) => driver.fullName.toLowerCase().includes(search)));
    return {
      total: filtered.length,
      items: filtered.slice(0, 100).map((vehicle) => ({
        bienSo: vehicle.plateNumber,
        loaiXe: labelOf(VEHICLE_LABEL, vehicle.vehicleType),
        ghiChu: vehicle.note || null,
        taiXe: vehicle.drivers.map((driver) => ({ hoTen: driver.fullName, soDienThoai: driver.phone || null, laTaiXeChinh: driver.isPrimary }))
      }))
    };
  }
}
