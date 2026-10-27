import type { SimulateOptions } from "./gate-passes.service";
import { placeholderCaptureImage } from "./gate.mock";
import type { CaptureShot } from "./gate.types";

/** Xe + tài xế mẫu cho DEMO_MODE=true — nạp thẳng vào bộ nhớ của MasterDataService, không qua Postgres. */
export interface DemoVehicleSeed {
  plateNumber: string;
  vehicleType: string | null;
  note: string;
  drivers: { fullName: string; phone: string; licenseNo: string; isPrimary: boolean }[];
}

export const DEMO_VEHICLES: DemoVehicleSeed[] = [
  {
    plateNumber: "51C-123.45",
    vehicleType: "dump_truck",
    note: "Xe ben chở đá — demo",
    drivers: [{ fullName: "Nguyễn Văn An", phone: "0901234567", licenseNo: "B2-123456", isPrimary: true }]
  },
  {
    plateNumber: "51D-678.90",
    vehicleType: "tractor_trailer",
    note: "Đầu kéo + rơ moóc — demo",
    drivers: [{ fullName: "Trần Văn Bình", phone: "0912345678", licenseNo: "FC-234567", isPrimary: true }]
  },
  {
    plateNumber: "61C-111.22",
    vehicleType: "truck",
    note: "Xe tải — demo",
    drivers: [{ fullName: "Lê Thị Cẩm", phone: "0923456789", licenseNo: "C-345678", isPrimary: true }]
  },
  {
    plateNumber: "50H-222.33",
    vehicleType: "flatbed_truck",
    note: "Xe tải thùng — demo",
    drivers: [{ fullName: "Phạm Văn Dũng", phone: "0934567890", licenseNo: "C-456789", isPrimary: true }]
  },
  {
    plateNumber: "51C-999.88",
    vehicleType: "dump_truck",
    note: "Xe ben chở đá — demo",
    drivers: [{ fullName: "Hoàng Thị Em", phone: "0945678901", licenseNo: "B2-567890", isPrimary: true }]
  }
];

/** `angleIndex`: 0=trước, 1=sau, 2=trái, 3=phải — xem placeholderCaptureImage ở gate.mock.ts. */
function okShot(angleIndex: number, plateNumber: string, vehicleType: string, material: string, ocrConfidence = 0.93): CaptureShot {
  const { cameraId, imageUrl } = placeholderCaptureImage(angleIndex, plateNumber, "ok");
  return {
    cameraId,
    plateNumber,
    ocrConfidence,
    detectorConfidence: 0.92,
    vehicleType: { code: vehicleType, confidence: 0.9, source: "model" },
    material: { code: material, confidence: 0.85, source: "model" },
    imageUrl,
    quality: "ok"
  };
}

/** Một lượt cân mô phỏng — entry (tareKg) hoặc exit (grossKg), đi qua đúng GatePassesService.simulateWeighAndCapture
 *  như nút "Mô phỏng cân + chụp" thật (xem DemoSeedService), không phải code riêng. */
export interface DemoLeg {
  options: SimulateOptions;
  /** Gán resolution ngay sau khi lượt này hoàn tất (chỉ set ở leg cuối cùng của mỗi xe). */
  resolve?: { decision: "CONFIRMED" | "REJECTED"; reason: string };
}

/**
 * Chuỗi lượt cân mẫu, mỗi xe 1-2 leg (vào/ra) — dựng đủ các trạng thái nghiệp vụ để xem demo: VERIFIED,
 * WAITING_SECOND_WEIGH, REVIEW_REQUIRED (cảnh báo OCR thấp), MISMATCH (quá tải), CAPTURE_FAILED (ảnh chụp
 * lỗi), NOT_IN_YARD (xe lạ). Chạy tuần tự, gần như đồng thời (xem DemoSeedService), nên các xe KHÔNG kết
 * thúc lượt (còn "mở" trên trạm cân: WAITING_SECOND_WEIGH/CAPTURE_FAILED/NOT_IN_YARD) phải dùng scaleId
 * riêng từng xe — nếu dùng chung 1 trạm, cơ chế ghép theo trạm cân (không còn biển số lúc cân, xem
 * GatePassesService.resolvePassForWeighSignal) sẽ tưởng lượt cân tiếp theo là lần cân thứ hai của xe cũ.
 * Các xe đã khép kín lượt (EXITED, dù resolution PENDING hay đã xử lý) dùng chung SCALE-01 vì không còn
 * "mở" để bị ghép nhầm nữa.
 */
export const DEMO_LEGS: DemoLeg[][] = [
  // 51C-123.45 — vào + ra khớp hoàn toàn → VERIFIED → CONFIRMED
  [
    { options: { plateNumber: "51C-123.45", scaleId: "SCALE-01", tareKg: 9000, shots: [okShot(0, "51C-123.45", "dump_truck", "stone_2_3")] } },
    {
      options: { plateNumber: "51C-123.45", scaleId: "SCALE-01", grossKg: 18500, shots: [okShot(0, "51C-123.45", "dump_truck", "stone_2_3")] },
      resolve: { decision: "CONFIRMED", reason: "Khớp đầy đủ camera ↔ cân — demo xác nhận." }
    }
  ],
  // 51C-999.88 — vào bình thường, ra quá tải cho phép → MISMATCH → REJECTED (xe trước đã khép kín, dùng lại SCALE-01 an toàn)
  [
    { options: { plateNumber: "51C-999.88", scaleId: "SCALE-01", tareKg: 9000, shots: [okShot(0, "51C-999.88", "dump_truck", "boulder")] } },
    {
      options: { plateNumber: "51C-999.88", scaleId: "SCALE-01", grossKg: 50_000, shots: [okShot(0, "51C-999.88", "dump_truck", "boulder")] },
      resolve: { decision: "REJECTED", reason: "Khối lượng vượt tải cho phép — demo minh hoạ xử lý quá tải." }
    }
  ],
  // 50H-222.33 — vào với OCR thấp (cảnh báo), ra bình thường → REVIEW_REQUIRED (cũng khép kín, dùng lại SCALE-01)
  [
    { options: { plateNumber: "50H-222.33", scaleId: "SCALE-01", tareKg: 4000, shots: [okShot(0, "50H-222.33", "flatbed_truck", "sand", 0.55)] } },
    { options: { plateNumber: "50H-222.33", scaleId: "SCALE-01", grossKg: 6000, shots: [okShot(0, "50H-222.33", "flatbed_truck", "sand")] } }
  ],
  // 61C-111.22 — mới vào, chưa ra → WAITING_SECOND_WEIGH (còn "mở" — scale riêng)
  [{ options: { plateNumber: "61C-111.22", scaleId: "SCALE-02", tareKg: 5000, shots: [okShot(0, "61C-111.22", "truck", "empty")] } }],
  // 51D-678.90 — vào nhưng ảnh chụp lỗi (mờ/không đọc được biển) → CAPTURE_FAILED (còn "mở" — scale riêng)
  [{ options: { plateNumber: "51D-678.90", scaleId: "SCALE-03", forceCaptureFailure: true } }],
  // 29A-555.66 — xe lạ, không có trong danh sách bãi → NOT_IN_YARD (còn "mở" — scale riêng)
  [{ options: { plateNumber: "29A-555.66", scaleId: "SCALE-04", tareKg: 1500, shots: [okShot(0, "29A-555.66", "car", "empty")] } }]
];
