export type ClassificationSource = "model" | "operator" | "unavailable";

/** Kết quả phân loại (loại xe / loại đá). `code` null nghĩa là chưa xác định được. */
export interface Classification {
  code: string | null;
  confidence: number | null;
  source: ClassificationSource;
}

/** Vùng biển số dạng tứ giác, toạ độ chuẩn hoá 0..1 theo frame gốc, thứ tự TL, TR, BR, BL. */
export interface PlateRegion {
  points: [number, number][];
  frameWidth: number | null;
  frameHeight: number | null;
  source: "model-contour" | "model-bbox";
}

export interface RegionBox {
  /** x1, y1, x2, y2 chuẩn hoá 0..1 theo frame gốc. */
  box: [number, number, number, number];
  source: "model" | "heuristic";
}

export interface PlateCapture {
  source: "video";
  videoJobId: string | null;
  cameraId: string;
  clockSource: "server" | "camera";
  capturedAt: string;
  mediaTimeSec: number | null;
  overviewUrl: string | null;
  plateCropUrl: string | null;
  vehicleImageUrl: string | null;
  loadImageUrl: string | null;
  vehicleBox: RegionBox | null;
  loadBox: RegionBox | null;
  trackId: string;
  /** [giây, x1, y1, x2, y2] chuẩn hoá: vị trí biển số theo thời gian để vẽ khung trên video. */
  trail: [number, number, number, number, number][];
  plateText: string;
  plateNormalized: string;
  ocrConfidence: number | null;
  detectorConfidence: number | null;
  plateRegion: PlateRegion | null;
}

/** Một lần cân từ trạm cân ngoài. grossKg = xe + hàng, tareKg = xe không; mỗi lần cân thường chỉ có một trong hai. */
export interface WeighReading {
  id: string;
  scaleId: string;
  ticketNo: string | null;
  plateNumber: string | null;
  grossKg: number | null;
  tareKg: number | null;
  measuredAt: string;
  receivedAt: string;
  source: "external" | "mock";
  gatePassId: string | null;
}

/** Tổng hợp hai lần cân (gross rồi tare) của một lượt xe. */
export interface WeighSummary {
  scaleId: string;
  ticketNo: string | null;
  plateNumber: string | null;
  grossKg: number | null;
  tareKg: number | null;
  netKg: number | null;
  grossAt: string | null;
  tareAt: string | null;
  firstMeasuredAt: string;
  readingIds: string[];
  source: "external" | "mock";
}

export type CheckResult = "pass" | "warn" | "fail" | "skipped";

export interface VerificationCheck {
  code: string;
  label: string;
  result: CheckResult;
  detail: string;
}

export type VerificationStatus = "WAITING_WEIGHT" | "WAITING_SECOND_WEIGH" | "VERIFIED" | "REVIEW_REQUIRED" | "MISMATCH";
export type Resolution = "PENDING" | "CONFIRMED" | "REJECTED";

export interface GateOverrides {
  plateNumber?: string;
  vehicleType?: string;
  material?: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface GatePass {
  id: string;
  createdAt: string;
  updatedAt: string;
  capture: PlateCapture;
  vehicleType: Classification;
  material: Classification;
  weighing: WeighSummary | null;
  checks: VerificationCheck[];
  status: VerificationStatus;
  resolution: Resolution;
  overrides: GateOverrides;
  /** Giá trị đang có hiệu lực sau khi áp dụng override của người vận hành. */
  effective: { plateNumber: string; vehicleType: string | null; material: string | null };
  audit: AuditEntry[];
}
