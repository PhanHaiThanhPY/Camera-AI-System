import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { findVehicleProfile, isKnownMaterial, MATERIALS, VEHICLE_PROFILES } from "./gate.catalog";

export interface ManualImportRow {
  plateNumber: string;
  vehicleTypeCode: string | null;
  materialCode: string | null;
  /** ISO 8601. */
  entryAt: string;
  tareKg: number;
  /** ISO 8601. */
  exitAt: string;
  grossKg: number;
  note: string | null;
}

export interface ImportRowError {
  row: number;
  message: string;
}

const SHEET_NAME = "Nhập liệu";
const CATALOG_SHEET_NAME = "Danh mục";
const MAX_TEMPLATE_ROWS = 500;

function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object" && "richText" in value) {
    const text = (value as { richText: { text: string }[] }).richText.map((part) => part.text).join("");
    return text.trim() === "" ? null : text.trim();
  }
  return String(value).trim() || null;
}

function cellToNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = Number(value.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(normalized) ? normalized : null;
  }
  return null;
}

/** Excel lưu ngày dạng số thứ tự kể từ 30/12/1899, không kèm timezone — chỉ gặp khi cell không được
 *  định dạng ngày. Trả về Date mà các field UTC (getUTCHours...) đúng bằng giờ "naive" trong Excel. */
function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays * 86400 * 1000);
}

/** Việt Nam dùng UTC+7 cố định (không có giờ mùa hè) — hiểu giờ người dùng gõ/chọn trong Excel là giờ
 *  Việt Nam, không phải giờ máy chủ chạy (máy chủ có thể ở timezone bất kỳ), khớp REPORT_TIMEZONE đã
 *  dùng cho báo cáo Telegram. */
const VN_UTC_OFFSET_HOURS = 7;
function vietnamWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - VN_UTC_OFFSET_HOURS, minute));
}

function parseDateCell(value: ExcelJS.CellValue): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    // exceljs trả Date mà các field UTC khớp đúng giờ "naive" hiển thị trong Excel (không tự trừ/cộng
    // timezone) — coi các field đó là giờ Việt Nam người dùng đã gõ.
    return vietnamWallClockToUtc(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes());
  }
  if (typeof value === "number") {
    const naive = excelSerialToDate(value);
    return vietnamWallClockToUtc(naive.getUTCFullYear(), naive.getUTCMonth() + 1, naive.getUTCDate(), naive.getUTCHours(), naive.getUTCMinutes());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (match !== null) {
      const [, d, m, y, h, min] = match;
      return vietnamWallClockToUtc(Number(y), Number(m), Number(d), h !== undefined ? Number(h) : 0, min !== undefined ? Number(min) : 0);
    }
    // Chuỗi có timezone rõ ràng (ISO kèm "Z"/offset) — Date.parse xử lý đúng, không cần quy đổi thêm.
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Sinh file Excel mẫu + đọc file đã điền — dùng cho nhập liệu lúc hệ thống chạy lại sau mất điện (xem
 * GatePassesService.importManualPasses). Không đụng DB/business logic — chỉ lo phần đọc/ghi Excel.
 */
@Injectable()
export class GateExcelService {
  public async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Camera AI System";
    workbook.created = new Date();

    const catalogSheet = workbook.addWorksheet(CATALOG_SHEET_NAME);
    catalogSheet.getRow(1).values = ["Mã loại xe", "Tên loại xe", "", "Mã vật liệu", "Tên vật liệu"];
    catalogSheet.getRow(1).font = { bold: true };
    VEHICLE_PROFILES.forEach((profile, index) => {
      catalogSheet.getCell(`A${index + 2}`).value = profile.code;
      catalogSheet.getCell(`B${index + 2}`).value = profile.label;
    });
    MATERIALS.forEach((material, index) => {
      catalogSheet.getCell(`D${index + 2}`).value = material.code;
      catalogSheet.getCell(`E${index + 2}`).value = material.label;
    });
    catalogSheet.columns = [{ width: 18 }, { width: 24 }, { width: 3 }, { width: 16 }, { width: 20 }];

    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.columns = [
      { header: "Biển số xe *", key: "plate", width: 16 },
      { header: "Mã loại xe", key: "vehicleType", width: 14 },
      { header: "Mã vật liệu", key: "material", width: 14 },
      { header: "Thời gian vào *", key: "entryAt", width: 20 },
      { header: "Cân vào - kg (bì) *", key: "tareKg", width: 16 },
      { header: "Thời gian ra *", key: "exitAt", width: 20 },
      { header: "Cân ra - kg (tổng) *", key: "grossKg", width: 18 },
      { header: "Ghi chú", key: "note", width: 32 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2554C7" } };
    sheet.getRow(1).alignment = { vertical: "middle" };

    sheet.addRow({
      plate: "51C-123.45",
      vehicleType: VEHICLE_PROFILES[0].code,
      material: MATERIALS[2].code,
      entryAt: "27/10/2026 08:15",
      tareKg: 9000,
      exitAt: "27/10/2026 09:40",
      grossKg: 18500,
      note: "VÍ DỤ — xoá dòng này trước khi nhập thật"
    });
    sheet.getRow(2).font = { italic: true, color: { argb: "FF8B93A3" } };

    // Chỉ nhận lượt ĐÃ CÂN XONG CẢ HAI ĐẦU (vào lẫn ra) trong lúc mất điện — xe còn đang cân giữa chừng lúc
    // có điện lại thì cân tiếp bằng trạm cân/camera thật như bình thường, không cần nhập Excel.
    for (let row = 3; row <= MAX_TEMPLATE_ROWS; row++) {
      sheet.getCell(`B${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [`'${CATALOG_SHEET_NAME}'!$A$2:$A$${VEHICLE_PROFILES.length + 1}`] };
      sheet.getCell(`C${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [`'${CATALOG_SHEET_NAME}'!$D$2:$D$${MATERIALS.length + 1}`] };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  public async parseWorkbook(buffer: Buffer): Promise<{ rows: ManualImportRow[]; errors: ImportRowError[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      // pnpm hoist ra 2 bản @types/node khác nhau (exceljs kéo theo bản riêng) nên TS coi 2 kiểu Buffer là
      // khác nhau dù cùng là Buffer thật lúc chạy — ép kiểu cho qua, không ảnh hưởng hành vi.
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new BadRequestException("Không đọc được file — chắc chắn đây là file .xlsx đúng định dạng.");
    }
    const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
    if (sheet === undefined) {
      throw new BadRequestException("File không có sheet dữ liệu.");
    }

    const rows: ManualImportRow[] = [];
    const errors: ImportRowError[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      const plate = cellToString(row.getCell(1).value);
      if (plate === null) {
        return;
      }
      try {
        const vehicleTypeCode = cellToString(row.getCell(2).value);
        const materialCode = cellToString(row.getCell(3).value);
        const entryAt = parseDateCell(row.getCell(4).value);
        const tareKg = cellToNumber(row.getCell(5).value);
        const exitAt = parseDateCell(row.getCell(6).value);
        const grossKg = cellToNumber(row.getCell(7).value);
        const note = cellToString(row.getCell(8).value);

        if (entryAt === null) {
          throw new Error("Thiếu hoặc sai định dạng Thời gian vào (dd/mm/yyyy hh:mm).");
        }
        if (tareKg === null || tareKg < 0) {
          throw new Error("Thiếu hoặc sai Cân vào (kg).");
        }
        if (exitAt === null) {
          throw new Error("Thiếu hoặc sai định dạng Thời gian ra (dd/mm/yyyy hh:mm).");
        }
        if (grossKg === null || grossKg < 0) {
          throw new Error("Thiếu hoặc sai Cân ra (kg).");
        }
        if (exitAt.getTime() < entryAt.getTime()) {
          throw new Error("Thời gian ra phải sau Thời gian vào.");
        }
        if (grossKg < tareKg) {
          throw new Error("Cân ra phải lớn hơn hoặc bằng Cân vào.");
        }
        if (vehicleTypeCode !== null && findVehicleProfile(vehicleTypeCode) === undefined) {
          throw new Error(`Mã loại xe "${vehicleTypeCode}" không có trong danh mục (xem sheet "${CATALOG_SHEET_NAME}").`);
        }
        if (materialCode !== null && !isKnownMaterial(materialCode)) {
          throw new Error(`Mã vật liệu "${materialCode}" không có trong danh mục (xem sheet "${CATALOG_SHEET_NAME}").`);
        }

        rows.push({
          plateNumber: plate,
          vehicleTypeCode,
          materialCode,
          entryAt: entryAt.toISOString(),
          tareKg,
          exitAt: exitAt.toISOString(),
          grossKg,
          note
        });
      } catch (error) {
        errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "Lỗi không xác định." });
      }
    });

    return { rows, errors };
  }
}
