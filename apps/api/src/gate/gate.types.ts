import type { MasterLink } from "./master.types";

export type ClassificationSource = "model" | "zero-shot" | "operator" | "unavailable";

/** Kết quả phân loại (loại xe / loại đá). `code` null nghĩa là chưa xác định được. */
export interface Classification {
  code: string | null;
  confidence: number | null;
  source: ClassificationSource;
}

/** Một lần nhận diện biển số, không giữ ảnh/khung — chỉ số liệu để chạy nghiệp vụ. */
export interface PlateCapture {
  /** "weighbridge" = lượt tạo thẳng từ số liệu cân, không qua nhận diện biển số. */
  source: "video" | "weighbridge";
  cameraId: string;
  clockSource: "server" | "camera";
  capturedAt: string;
  trackId: string;
  plateText: string;
  plateNormalized: string;
  ocrConfidence: number | null;
  detectorConfidence: number | null;
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
  /** Lượt nhận diện lúc xe ra — null khi xe chưa ra, hoặc lượt này không có camera xác nhận lúc ra. */
  exitCapture: PlateCapture | null;
  vehicleType: Classification;
  material: Classification;
  weighing: WeighSummary | null;
  checks: VerificationCheck[];
  status: VerificationStatus;
  /** Lý do dẫn tới trạng thái hiện tại (rỗng khi Khớp). */
  statusReasons: string[];
  /** Trạng thái ra/vào bãi theo camera, tách khỏi status (status là kết quả kiểm tra chéo, phụ thuộc cân). */
  visitStatus: VisitStatus;
  resolution: Resolution;
  overrides: GateOverrides;
  /** Giá trị đang có hiệu lực sau khi áp dụng override của người vận hành. */
  effective: { plateNumber: string; vehicleType: string | null; material: string | null };
  audit: AuditEntry[];
}

/**
 * Một lượt nhận diện đẩy về từ lớp Python (xem services/ai-worker trước đây, nay python/detect) qua
 * `POST /api/gate/detections`. Không còn ảnh/khung — chỉ số liệu để ghép lượt xe và chạy nghiệp vụ.
 */
export interface DetectionInput {
  cameraId: string;
  /** Mã theo dõi một xe xuyên suốt phiên nhận diện (ví dụ track id của tracker); trống thì ghép theo biển số. */
  trackId?: string;
  plateNumber: string;
  ocrConfidence?: number | null;
  detectorConfidence?: number | null;
  vehicleType?: Classification;
  material?: Classification;
  capturedAt?: string;
  /** true khi đây là lần cập nhật cuối của track này (đã đủ tin cậy để chốt). */
  final?: boolean;
}
