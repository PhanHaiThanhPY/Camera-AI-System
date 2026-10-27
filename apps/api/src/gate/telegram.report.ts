import type { GatePass, VerificationStatus } from "./gate.types";

const TELEGRAM_LIMIT = 3900;

const STATUS_TEXT: Record<VerificationStatus, { icon: string; label: string }> = {
  VERIFIED: { icon: "✅", label: "Khớp" },
  REVIEW_REQUIRED: { icon: "⚠️", label: "Cần xem lại" },
  MISMATCH: { icon: "❌", label: "Không khớp" },
  NOT_IN_YARD: { icon: "🚫", label: "Không tìm thấy xe ở bãi" },
  WAITING_SECOND_WEIGH: { icon: "⏳", label: "Chờ cân lần 2" },
  WAITING_WEIGHT: { icon: "⏳", label: "Chờ cân lần 1" },
  WAITING_CAPTURE: { icon: "📷", label: "Đang chờ ảnh chụp" },
  CAPTURE_FAILED: { icon: "🔍", label: "Cần kiểm tra lại (ảnh chụp lỗi)" }
};
const STATUS_ORDER: VerificationStatus[] = [
  "VERIFIED",
  "REVIEW_REQUIRED",
  "MISMATCH",
  "CAPTURE_FAILED",
  "NOT_IN_YARD",
  "WAITING_CAPTURE",
  "WAITING_SECOND_WEIGH",
  "WAITING_WEIGHT"
];
const MATERIAL_LABELS: Record<string, string> = { sand: "Cát", stone_2_3: "Đá 2–3", stone_4_6: "Đá 4–6", boulder: "Đá tảng", empty: "Không chở hàng" };

export interface ReportOptions {
  /** yyyy-mm-dd theo múi giờ báo cáo. */
  date: string;
  timeZone: string;
}

export interface BuiltReport {
  date: string;
  total: number;
  messages: string[];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** yyyy-mm-dd của một thời điểm theo múi giờ cho trước. */
export function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const timeInZone = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("vi-VN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

const vn = (value: number): string => value.toLocaleString("vi-VN");

/** Căn cột; luôn chừa ít nhất 1 khoảng trắng để cột sau không dính vào. */
function pad(value: string, width: number): string {
  const text = value.length > width - 1 ? `${value.slice(0, width - 2)}…` : value;
  return text.padEnd(width, " ");
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function driverName(pass: GatePass): string {
  const primary = pass.master.drivers.find((driver) => driver.isPrimary) ?? pass.master.drivers[0];
  return primary?.fullName ?? "-";
}

/** Chia các dòng thành nhiều tin để không vượt giới hạn 4096 ký tự của Telegram. */
function chunkRows(header: string, rows: string[], budget: number): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let length = header.length;
  for (const row of rows) {
    if (length + row.length + 1 > budget && current.length > 0) {
      blocks.push(`<pre>${header}\n${current.join("\n")}</pre>`);
      current = [];
      length = header.length;
    }
    current.push(row);
    length += row.length + 1;
  }
  if (current.length > 0) {
    blocks.push(`<pre>${header}\n${current.join("\n")}</pre>`);
  }
  return blocks;
}

/** Báo cáo ngày: tóm tắt cho sếp, danh sách cần chú ý, bảng chi tiết. Nhiều tin nếu dài. */
export function buildReport(allPasses: GatePass[], options: ReportOptions): BuiltReport {
  const { date, timeZone } = options;
  const passes = allPasses
    .filter((pass) => dateInZone(pass.capture.capturedAt, timeZone) === date)
    .sort((first, second) => first.capture.capturedAt.localeCompare(second.capture.capturedAt));

  const title = `📊 <b>BÁO CÁO XE RA VÀO</b>\n🗓 Ngày <b>${formatDate(date)}</b>`;
  if (passes.length === 0) {
    return { date, total: 0, messages: [`${title}\n\nKhông có lượt xe nào trong ngày này.`] };
  }

  const count = (status: VerificationStatus): number => passes.filter((pass) => pass.status === status).length;
  const statusLines = STATUS_ORDER.filter((status) => count(status) > 0).map((status) => `${STATUS_TEXT[status].icon} ${STATUS_TEXT[status].label}: <b>${count(status)}</b>`);
  const confirmed = passes.filter((pass) => pass.resolution === "CONFIRMED").length;
  const rejected = passes.filter((pass) => pass.resolution === "REJECTED").length;
  const pending = passes.length - confirmed - rejected;

  const netOf = (pass: GatePass): number => pass.weighing?.netKg ?? 0;
  const totalNet = passes.reduce((sum, pass) => sum + netOf(pass), 0);
  const byMaterial = new Map<string, { trips: number; net: number }>();
  for (const pass of passes) {
    const key = pass.effective.material === null ? "Chưa xác định" : (MATERIAL_LABELS[pass.effective.material] ?? pass.effective.material);
    const entry = byMaterial.get(key) ?? { trips: 0, net: 0 };
    entry.trips += 1;
    entry.net += netOf(pass);
    byMaterial.set(key, entry);
  }
  const materialLines = [...byMaterial.entries()].map(([label, entry]) => `• ${escapeHtml(label)}: ${entry.trips} lượt · ${vn(entry.net)} kg`);

  const summary = [
    title,
    "━━━━━━━━━━━━━━━━",
    `🚚 Tổng số lượt: <b>${passes.length}</b>`,
    `⚖️ Tổng khối lượng hàng: <b>${vn(totalNet)} kg</b> (${(totalNet / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tấn)`,
    "",
    "<b>Kết quả kiểm tra</b>",
    ...statusLines,
    "",
    "<b>Xử lý</b>",
    `👍 Đã xác nhận: ${confirmed} · 👎 Từ chối: ${rejected} · 🕓 Chưa xử lý: ${pending}`,
    "",
    "<b>Theo loại đá</b>",
    ...materialLines
  ].join("\n");

  const messages = [summary];

  const attention = passes.filter((pass) => pass.status !== "VERIFIED" && pass.resolution === "PENDING");
  if (attention.length > 0) {
    const lines = attention.slice(0, 15).map((pass) => {
      const status = STATUS_TEXT[pass.status];
      const reasons = pass.statusReasons.map((reason) => escapeHtml(reason)).join("; ") || status.label;
      return `${status.icon} <b>${escapeHtml(pass.effective.plateNumber)}</b> (${timeInZone(pass.capture.capturedAt, timeZone)}): ${reasons}`;
    });
    const extra = attention.length > 15 ? `\n… và ${attention.length - 15} lượt khác` : "";
    messages.push(`🔔 <b>CẦN CHÚ Ý (${attention.length})</b>\n${lines.join("\n")}${extra}`);
  }

  const header = `${"#".padEnd(3)}${pad("Giờ", 6)}${pad("Biển số", 11)}${pad("Tài xế", 12)}${pad("Hàng kg", 8)}TT`;
  const rows = passes.map((pass, index) => {
    const net = pass.weighing?.netKg === null || pass.weighing === null ? "-" : vn(pass.weighing.netKg);
    return `${String(index + 1).padEnd(3)}${pad(timeInZone(pass.capture.capturedAt, timeZone), 6)}${pad(escapeHtml(pass.effective.plateNumber), 11)}${pad(escapeHtml(driverName(pass)), 12)}${pad(net, 8)}${STATUS_TEXT[pass.status].icon}`;
  });
  const detailBlocks = chunkRows(header, rows, TELEGRAM_LIMIT - 120);
  detailBlocks.forEach((block, index) => {
    messages.push(`📋 <b>CHI TIẾT${detailBlocks.length > 1 ? ` (${index + 1}/${detailBlocks.length})` : ""}</b>\n${block}`);
  });

  return { date, total: passes.length, messages };
}

/** Bản chữ thường để xem trước trên giao diện (bỏ thẻ HTML). */
export function toPlainText(messages: string[]): string {
  return messages
    .map((message) => message.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .join("\n\n");
}
