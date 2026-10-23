import { EMPTY_MATERIAL, findVehicleProfile, isKnownMaterial } from "./gate.catalog";
import type { MasterLink } from "./master.types";
import type { GatePass, VerificationCheck, VerificationStatus, VisitStatus, WeighReading, WeighSummary } from "./gate.types";

export interface VerificationConfig {
  matchWindowSeconds: number;
  minOcrConfidence: number;
  /** Net dưới ngưỡng này coi như xe không chở hàng. */
  emptyNetKg: number;
  /** Cửa sổ ghép lần cân thứ hai (gross → tare), thường dài hơn nhiều so với cửa sổ chụp↔cân. */
  secondWeighWindowSeconds: number;
}

/** Loại xe có thùng hàng, cần xác định loại đá. */
const CARGO_VEHICLES = new Set(["truck", "dump_truck", "tractor_trailer", "flatbed_truck", "light_truck", "pickup"]);

export function readVerificationConfig(): VerificationConfig {
  return {
    matchWindowSeconds: Number(process.env.GATE_MATCH_WINDOW_SECONDS ?? 180),
    minOcrConfidence: Number(process.env.GATE_MIN_OCR_CONFIDENCE ?? 0.6),
    emptyNetKg: Number(process.env.GATE_EMPTY_NET_KG ?? 500),
    secondWeighWindowSeconds: Number(process.env.GATE_SECOND_WEIGH_WINDOW_SECONDS ?? 14400)
  };
}

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function editDistance(first: string, second: string): number {
  const row = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= second.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + (first[i - 1] === second[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[second.length] ?? 0;
}

function check(code: string, label: string, result: VerificationCheck["result"], detail: string): VerificationCheck {
  return { code, label, result, detail };
}

/** Chạy toàn bộ kiểm tra chéo camera ↔ cân. Hàm thuần: cùng đầu vào cho cùng kết quả. */
export function runChecks(
  pass: Pick<GatePass, "capture" | "effective" | "weighing" | "master">,
  config: VerificationConfig
): VerificationCheck[] {
  const { capture, effective, weighing, master } = pass;
  const checks: VerificationCheck[] = [];

  if (master.match === "exact") {
    checks.push(check("YARD_VEHICLE", "Xe có trong bãi (master data)", "pass", `Xe ${master.plateNumber ?? ""} có trong danh sách.`));
  } else if (master.match === "near") {
    checks.push(check("YARD_VEHICLE", "Xe có trong bãi (master data)", "warn", `Biển quét lệch 1 ký tự so với xe ${master.plateNumber ?? ""}; kiểm tra lại biển.`));
  } else {
    checks.push(check("YARD_VEHICLE", "Xe có trong bãi (master data)", "fail", "Không tìm thấy xe ở bãi."));
  }

  if (capture.ocrConfidence === null) {
    checks.push(check("OCR_CONFIDENCE", "Độ tin cậy đọc biển", "skipped", "Không có điểm OCR."));
  } else if (capture.ocrConfidence < config.minOcrConfidence) {
    checks.push(
      check("OCR_CONFIDENCE", "Độ tin cậy đọc biển", "warn", `OCR ${capture.ocrConfidence.toFixed(2)} < ${config.minOcrConfidence}.`)
    );
  } else {
    checks.push(check("OCR_CONFIDENCE", "Độ tin cậy đọc biển", "pass", `OCR ${capture.ocrConfidence.toFixed(2)}.`));
  }

  checks.push(
    effective.vehicleType === null
      ? check("VEHICLE_TYPE", "Loại xe", "warn", "Chưa xác định loại xe.")
      : check("VEHICLE_TYPE", "Loại xe", "pass", effective.vehicleType)
  );
  const carriesCargo = effective.vehicleType !== null && CARGO_VEHICLES.has(effective.vehicleType);
  checks.push(
    effective.material === null
      ? carriesCargo
        ? check("MATERIAL", "Loại đá", "warn", "Chưa xác định loại đá.")
        : check("MATERIAL", "Loại đá", "skipped", "Loại xe này không chở đá.")
      : isKnownMaterial(effective.material)
        ? check("MATERIAL", "Loại đá", "pass", effective.material)
        : check("MATERIAL", "Loại đá", "fail", `Mã loại đá không có trong danh mục: ${effective.material}.`)
  );

  if (weighing === null) {
    return checks;
  }

  const cameraPlate = normalizePlate(effective.plateNumber);
  if (weighing.plateNumber === null) {
    checks.push(check("PLATE_MATCH", "Biển số camera ↔ phiếu cân", "skipped", "Phiếu cân không có biển số."));
  } else {
    const scalePlate = normalizePlate(weighing.plateNumber);
    const distance = editDistance(cameraPlate, scalePlate);
    checks.push(
      distance === 0
        ? check("PLATE_MATCH", "Biển số camera ↔ phiếu cân", "pass", `Trùng khớp ${scalePlate}.`)
        : distance === 1
          ? check("PLATE_MATCH", "Biển số camera ↔ phiếu cân", "warn", `Lệch 1 ký tự: camera ${cameraPlate}, cân ${scalePlate}.`)
          : check("PLATE_MATCH", "Biển số camera ↔ phiếu cân", "fail", `Khác biển số: camera ${cameraPlate}, cân ${scalePlate}.`)
    );
  }

  const gapSeconds = Math.abs(Date.parse(weighing.firstMeasuredAt) - Date.parse(capture.capturedAt)) / 1000;
  checks.push(
    gapSeconds <= config.matchWindowSeconds
      ? check("TIME_WINDOW", "Thời điểm chụp ↔ cân", "pass", `Lệch ${Math.round(gapSeconds)} giây.`)
      : check("TIME_WINDOW", "Thời điểm chụp ↔ cân", "fail", `Lệch ${Math.round(gapSeconds)} giây > ${config.matchWindowSeconds}.`)
  );

  const net = weighing.netKg;
  const profile = findVehicleProfile(effective.vehicleType);

  if (net !== null && net < 0) {
    checks.push(check("NET_WEIGHT", "Khối lượng hàng", "fail", `Net âm (${net} kg): gross nhỏ hơn tare.`));
  } else if (net !== null && effective.material !== null) {
    const isEmptyClaim = effective.material === EMPTY_MATERIAL;
    if (isEmptyClaim && net > config.emptyNetKg) {
      checks.push(check("NET_WEIGHT", "Khối lượng hàng", "fail", `Xe được nhận là không tải nhưng net ${net} kg.`));
    } else if (!isEmptyClaim && net <= config.emptyNetKg) {
      checks.push(check("NET_WEIGHT", "Khối lượng hàng", "warn", `Có loại đá nhưng net chỉ ${net} kg.`));
    } else {
      checks.push(check("NET_WEIGHT", "Khối lượng hàng", "pass", `Net ${net} kg.`));
    }
  } else {
    checks.push(check("NET_WEIGHT", "Khối lượng hàng", "skipped", "Chưa đủ hai lần cân hoặc thiếu loại đá."));
  }

  if (profile === undefined) {
    checks.push(check("WEIGHT_RANGE", "Khối lượng so với loại xe", "skipped", "Chưa có loại xe để đối chiếu."));
  } else if (weighing.grossKg !== null && weighing.grossKg > profile.maxGrossKg) {
    checks.push(
      check("WEIGHT_RANGE", "Khối lượng so với loại xe", "fail", `Gross ${weighing.grossKg} kg vượt ${profile.maxGrossKg} kg (${profile.label}).`)
    );
  } else if (
    weighing.tareKg !== null &&
    (weighing.tareKg < profile.tareKgRange[0] || weighing.tareKg > profile.tareKgRange[1])
  ) {
    checks.push(
      check(
        "WEIGHT_RANGE",
        "Khối lượng so với loại xe",
        "warn",
        `Tare ${weighing.tareKg} kg ngoài khoảng ${profile.tareKgRange[0]}–${profile.tareKgRange[1]} kg của ${profile.label}.`
      )
    );
  } else {
    checks.push(check("WEIGHT_RANGE", "Khối lượng so với loại xe", "pass", `Phù hợp ${profile.label}.`));
  }

  return checks;
}

/**
 * Trạng thái ra/vào: theo CAMERA thấy xe (độc lập với cân, vì cân có thể tắt hoặc chưa nối trạm thật).
 * Có record (dù từ camera hay từ cân) = ĐÃ VÀO. Camera thấy lại xe lúc ra (exitCapture) HOẶC đủ cả hai lần
 * cân (trường hợp record tạo thẳng từ cân, không có camera) = ĐÃ RA, lượt khép kín.
 */
export function computeVisitStatus(pass: Pick<GatePass, "exitCapture" | "weighing">): VisitStatus {
  const exitedByCamera = pass.exitCapture !== null;
  const exitedByWeighing = pass.weighing !== null && pass.weighing.grossKg !== null && pass.weighing.tareKg !== null;
  return exitedByCamera || exitedByWeighing ? "EXITED" : "ENTERED";
}

export function deriveStatus(checks: VerificationCheck[], weighing: WeighSummary | null, master: MasterLink): VerificationStatus {
  if (master.match === "none") {
    return "NOT_IN_YARD";
  }
  if (weighing === null) {
    return "WAITING_WEIGHT";
  }
  if (checks.some((item) => item.result === "fail")) {
    return "MISMATCH";
  }
  if (weighing.grossKg === null || weighing.tareKg === null) {
    return "WAITING_SECOND_WEIGH";
  }
  return checks.some((item) => item.result === "warn") ? "REVIEW_REQUIRED" : "VERIFIED";
}

/** Điểm ghép phiếu cân với lượt chụp; null nếu ngoài cửa sổ thời gian. */
export function matchScore(
  pass: Pick<GatePass, "capture" | "effective">,
  reading: Pick<WeighReading, "plateNumber" | "measuredAt">,
  windowSeconds: number
): number | null {
  // A reading without a plate must be linked by an operator; time alone is not
  // enough to identify a vehicle safely.
  if (reading.plateNumber === null) {
    return null;
  }

  const gapSeconds = Math.abs(Date.parse(reading.measuredAt) - Date.parse(pass.capture.capturedAt)) / 1000;
  if (!Number.isFinite(gapSeconds) || gapSeconds > windowSeconds) {
    return null;
  }

  const distance = editDistance(normalizePlate(pass.effective.plateNumber), normalizePlate(reading.plateNumber));
  if (distance > 1) {
    return null;
  }

  const plateScore = distance === 0 ? 2 : 1;
  return plateScore + (1 - gapSeconds / windowSeconds) * 0.5;
}

/** Điểm ghép lần cân thứ hai vào lượt xe đã có một lần cân; bắt buộc biển số khớp vì khoảng cách thời gian lớn. */
export function secondWeighScore(
  pass: Pick<GatePass, "effective" | "weighing">,
  reading: Pick<WeighReading, "plateNumber" | "grossKg" | "tareKg" | "measuredAt">,
  windowSeconds: number
): number | null {
  const { weighing } = pass;
  if (weighing === null || reading.plateNumber === null) {
    return null;
  }
  const providesMissing = (weighing.grossKg === null && reading.grossKg !== null) || (weighing.tareKg === null && reading.tareKg !== null);
  const duplicates = (weighing.grossKg !== null && reading.grossKg !== null) || (weighing.tareKg !== null && reading.tareKg !== null);
  if (!providesMissing || duplicates) {
    return null;
  }
  const distance = editDistance(normalizePlate(weighing.plateNumber ?? pass.effective.plateNumber), normalizePlate(reading.plateNumber));
  const gapSeconds = Math.abs(Date.parse(reading.measuredAt) - Date.parse(weighing.firstMeasuredAt)) / 1000;
  if (distance > 1 || !Number.isFinite(gapSeconds) || gapSeconds > windowSeconds) {
    return null;
  }
  return 2 - distance - gapSeconds / windowSeconds;
}

/** Lý do của trạng thái, để người vận hành biết vì sao xe cần xem lại / không khớp. */
export function deriveReasons(status: VerificationStatus, checks: VerificationCheck[]): string[] {
  const describe = (item: VerificationCheck): string => `${item.label}: ${item.detail}`;
  switch (status) {
    case "NOT_IN_YARD":
      return checks.filter((item) => item.code === "YARD_VEHICLE").map(describe);
    case "WAITING_WEIGHT":
      return ["Chưa có số liệu cân đầu vào."];
    case "WAITING_SECOND_WEIGH":
      return ["Xe đã vào bãi, đang chờ cân đầu ra."];
    case "MISMATCH":
      return checks.filter((item) => item.result === "fail").map(describe);
    case "REVIEW_REQUIRED":
      return checks.filter((item) => item.result === "warn").map(describe);
    default:
      return [];
  }
}
