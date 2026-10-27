import { MATERIALS, VEHICLE_PROFILES } from "./gate.catalog";
import type { CaptureShot } from "./gate.types";

const KG_STEP = 100;

function randomStep(minKg: number, maxKg: number): number {
  const steps = Math.floor((maxKg - minKg) / KG_STEP);
  return minKg + Math.floor(Math.random() * (steps + 1)) * KG_STEP;
}

/**
 * Cân nặng giả lập, random mỗi lần gọi (hard code, chưa có trạm cân thật — tắt bằng WEIGHBRIDGE_MOCK_RANDOM=false).
 * Tare (xe không, lúc vào) 1,0–1,5 tấn; hàng (đá chở ra) 0,6–1,5 tấn, làm tròn 100 kg (ví dụ 1 tấn 1, 1 tấn 2).
 * Gross (lúc ra) = tare + hàng.
 */
export function randomTareKg(): number {
  return randomStep(1000, 1500);
}

export function randomNetKg(): number {
  return randomStep(600, 1500);
}

const DEMO_PLATE_PREFIXES = ["51C", "51D", "61C", "50H", "29A"];

/** Biển số ngẫu nhiên hợp lệ (biển VN) cho nút "Mô phỏng cân + chụp". */
export function randomDemoPlate(): string {
  const prefix = DEMO_PLATE_PREFIXES[Math.floor(Math.random() * DEMO_PLATE_PREFIXES.length)];
  const digits = String(Math.floor(10_000 + Math.random() * 89_999));
  return `${prefix}-${digits.slice(0, 3)}.${digits.slice(3)}`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

/** 4 góc camera chuẩn quanh xe (trước/sau/trái/phải) — màu nền khác nhau để 4 ảnh mô phỏng không nhìn giống
 *  y hệt nhau. `angleIndex` ngoài phạm vi 4 (CAPTURE_EXPECTED_SHOTS khác 4) thì quay vòng lại từ đầu. */
const CAMERA_ANGLES = [
  { id: "CAM-TRUOC", label: "Góc trước", hue: "#15324a" },
  { id: "CAM-SAU", label: "Góc sau", hue: "#3a1f44" },
  { id: "CAM-TRAI", label: "Góc trái", hue: "#163d2e" },
  { id: "CAM-PHAI", label: "Góc phải", hue: "#4a2a12" }
];

/**
 * Ảnh "chụp" giả cho demo/mô phỏng — không có camera/MinIO thật nên dựng một SVG riêng cho từng góc camera
 * (`angleIndex`: 0=trước, 1=sau, 2=trái, 3=phải — màu nền + nhãn góc khác nhau để 4 ảnh không nhìn như 1),
 * ghi rõ biển số + trạng thái đọc được, đóng khung "ẢNH MÔ PHỎNG" để không ai nhầm là ảnh thật. Trả về
 * data URI, hiển thị được ngay trong <img> trên dashboard như ảnh thật, không cần tải/lưu file.
 */
export function placeholderCaptureImage(angleIndex: number, label: string, quality: CaptureShot["quality"] = "ok"): { cameraId: string; imageUrl: string } {
  const angle = CAMERA_ANGLES[angleIndex % CAMERA_ANGLES.length];
  const lap = Math.floor(angleIndex / CAMERA_ANGLES.length);
  const cameraId = lap === 0 ? angle.id : `${angle.id}-${lap + 1}`;
  const bg = quality === "ok" ? angle.hue : quality === "blurry" ? "#3a3326" : "#3a2420";
  const status = quality === "ok" ? "ẢNH MÔ PHỎNG" : quality === "blurry" ? "ẢNH MÔ PHỎNG · MỜ" : "ẢNH MÔ PHỎNG · KHÔNG THẤY BIỂN";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect x="8" y="8" width="304" height="184" fill="none" stroke="#ffffff40" stroke-width="2"/>
    <circle cx="34" cy="34" r="18" fill="#ffffff22" stroke="#ffffff88" stroke-width="2"/>
    <text x="34" y="40" fill="#ffffff" font-size="18" font-weight="700" text-anchor="middle" font-family="sans-serif">${angleIndex + 1}</text>
    <text x="60" y="38" fill="#ffffffcc" font-size="15" font-weight="700" text-anchor="start" font-family="sans-serif">${escapeXml(angle.label)}</text>
    <text x="50%" y="58%" fill="#ffffff" font-size="26" font-weight="700" text-anchor="middle" font-family="monospace">${escapeXml(label)}</text>
    <text x="50%" y="75%" fill="#ffffffaa" font-size="13" text-anchor="middle" font-family="sans-serif">${escapeXml(cameraId)}</text>
    <text x="50%" y="92%" fill="#ffffff77" font-size="10" text-anchor="middle" font-family="sans-serif" letter-spacing="1">${status}</text>
  </svg>`;
  return { cameraId, imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}` };
}

/**
 * Dựng sẵn `count` lần "camera trả kết quả" cho mô phỏng (nút "Mô phỏng cân + chụp" / DemoSeedService) — mặc
 * định ~1/5 khả năng toàn bộ shot hỏng (mờ/không đọc được) để demo được cả trạng thái CAPTURE_FAILED, còn
 * lại random 1 loại xe + 1 loại đá hợp lý dùng chung cho cả batch (giống thật: các camera cùng chụp 1 xe).
 */
export function randomDemoShots(plateNumber: string, count: number, forceFailure: boolean = Math.random() < 0.2): CaptureShot[] {
  const vehicle = VEHICLE_PROFILES[Math.floor(Math.random() * VEHICLE_PROFILES.length)];
  const material = MATERIALS[Math.floor(Math.random() * MATERIALS.length)];
  return Array.from({ length: count }, (_, index) => {
    if (forceFailure) {
      const quality = Math.random() < 0.5 ? "blurry" : "no_plate";
      const { cameraId, imageUrl } = placeholderCaptureImage(index, "?", quality);
      return { cameraId, plateNumber: null, ocrConfidence: null, detectorConfidence: null, imageUrl, quality };
    }
    const { cameraId, imageUrl } = placeholderCaptureImage(index, plateNumber, "ok");
    return {
      cameraId,
      plateNumber,
      ocrConfidence: Math.round((0.85 + Math.random() * 0.14) * 100) / 100,
      detectorConfidence: Math.round((0.85 + Math.random() * 0.14) * 100) / 100,
      vehicleType: { code: vehicle.code, confidence: 0.9, source: "model" },
      material: { code: material.code, confidence: 0.85, source: "model" },
      imageUrl,
      quality: "ok"
    };
  });
}
