import type { MasterLink } from "./master.types";

export type ClassificationSource = "model" | "zero-shot" | "operator" | "unavailable";

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
  /** "weighbridge" = lượt không có ảnh camera, tạo thẳng từ số liệu cân (ví dụ xe cân lại sau khi đã vào/ra xong lượt trước). */
  source: "video" | "weighbridge";
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

export type VerificationStatus = "NOT_IN_YARD" | "WAITING_WEIGHT" | "WAITING_SECOND_WEIGH" | "VERIFIED" | "REVIEW_REQUIRED" | "MISMATCH";
export type Resolution = "PENDING" | "CONFIRMED" | "REJECTED";
/**
 * Vòng vào/ra của một lượt xe: ENTERED = đã cân đầu vào, đang trong bãi; EXITED = đã cân đầu ra, hoàn tất lượt
 * (net = cân ra − cân vào = khối lượng đá chở ra). null = chưa cân lần nào. Xe cân tiếp sau khi đã EXITED sẽ
 * tạo một GatePass/lượt mới (không ghi đè lượt đã xong) — xem GatePassesService.ingestReading.
 */
export type VisitStatus = "ENTERED" | "EXITED";

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
  /** Đối chiếu với danh sách xe trong bãi (master data) và tài xế của xe đó. */
  master: MasterLink;
  id: string;
  createdAt: string;
  updatedAt: string;
  capture: PlateCapture;
  /** Ảnh chụp lúc xe ra (biển/xe/đá/toàn cảnh) — null khi xe chưa ra, hoặc lượt này không có camera xác nhận lúc ra. */
  exitCapture: PlateCapture | null;
  vehicleType: Classification;
  material: Classification;
  weighing: WeighSummary | null;
  checks: VerificationCheck[];
  status: VerificationStatus;
  /** Lý do dẫn tới trạng thái hiện tại (rỗng khi Khớp). */
  statusReasons: string[];
  /** Trạng thái ra/vào bãi, tách khỏi status (status là kết quả kiểm tra chéo). null = chưa cân lần nào. */
  visitStatus: VisitStatus | null;
  resolution: Resolution;
  overrides: GateOverrides;
  /** Giá trị đang có hiệu lực sau khi áp dụng override của người vận hành. */
  effective: { plateNumber: string; vehicleType: string | null; material: string | null };
  audit: AuditEntry[];
}
