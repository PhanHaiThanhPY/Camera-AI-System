import { FormEvent, ReactElement, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** State dùng chung cho lightbox phóng to ảnh — mỗi nơi có ảnh (CaptureGallery, PhienCanPanel, CapturesTable)
 *  tự giữ state riêng qua hook này, chỉ dùng chung component <Lightbox>. */
export function useLightbox(): { openUrl: string | null; open: (url: string) => void; close: () => void } {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  return { openUrl, open: setOpenUrl, close: () => setOpenUrl(null) };
}

/** Bấm vào bất kỳ ảnh nào cũng mở ảnh đó phóng to toàn màn hình — bấm ra ngoài, bấm nút đóng, hoặc Esc để thoát. */
export function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }): ReactElement | null {
  useEffect(() => {
    if (url === null) {
      return undefined;
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [url, onClose]);

  if (url === null) {
    return null;
  }
  return (
    <div className="lightbox-overlay" onClick={onClose} role="presentation">
      <button aria-label="Đóng ảnh" className="lightbox-close" onClick={onClose} type="button">×</button>
      <img alt="Ảnh phóng to" className="lightbox-image" onClick={(event) => event.stopPropagation()} src={url} />
    </div>
  );
}

export type VerificationStatus =
  | "NOT_IN_YARD"
  | "WAITING_CAPTURE"
  | "WAITING_WEIGHT"
  | "WAITING_SECOND_WEIGH"
  | "VERIFIED"
  | "REVIEW_REQUIRED"
  | "MISMATCH"
  | "CAPTURE_FAILED";
export type Resolution = "PENDING" | "CONFIRMED" | "REJECTED";
/** ENTERED = đã cân đầu vào, đang trong bãi. EXITED = đã cân đầu ra, lượt khép kín (net = cân ra − cân vào). */
export type VisitStatus = "ENTERED" | "EXITED";
type CheckResult = "pass" | "warn" | "fail" | "skipped";

export interface Classification {
  code: string | null;
  confidence: number | null;
  source: "model" | "zero-shot" | "operator" | "unavailable";
}

export interface MasterLink {
  match: "exact" | "near" | "none";
  vehicleId: string | null;
  plateNumber: string | null;
  drivers: { id: string; fullName: string; phone: string; isPrimary: boolean }[];
}

export interface PlateCapture {
  source: "video" | "weighbridge";
  cameraId: string;
  capturedAt: string;
  plateText: string;
  ocrConfidence: number | null;
  detectorConfidence: number | null;
  /** Link ảnh (MinIO) chụp lúc nhận diện. null = chưa cấu hình MinIO hoặc lượt từ cân (weighbridge). */
  imageUrl: string | null;
}

export interface CaptureAttempt {
  cameraId: string;
  plateNumber: string | null;
  ocrConfidence: number | null;
  imageUrl: string | null;
  quality: "ok" | "blurry" | "no_plate";
}

export interface GatePass {
  master: MasterLink;
  id: string;
  /** null = luồng bình thường/đã xong. "pending" = đang chờ ảnh camera. "failed" = CAPTURE_FAILED. */
  captureState: "pending" | "failed" | null;
  captureAttempts: CaptureAttempt[];
  capture: PlateCapture;
  /** Ảnh chụp lúc xe ra — null khi xe chưa ra hoặc lượt này không có camera xác nhận lúc ra. */
  exitCapture: PlateCapture | null;
  vehicleType: Classification;
  material: Classification;
  weighing: {
    scaleId: string;
    ticketNo: string | null;
    plateNumber: string | null;
    grossKg: number | null;
    tareKg: number | null;
    netKg: number | null;
    grossAt: string | null;
    tareAt: string | null;
    source: "external" | "mock";
  } | null;
  checks: { code: string; label: string; result: CheckResult; detail: string }[];
  status: VerificationStatus;
  statusReasons: string[];
  visitStatus: VisitStatus;
  resolution: Resolution;
  effective: { plateNumber: string; vehicleType: string | null; material: string | null };
  audit: { at: string; actor: string; action: string; reason: string | null }[];
}

export interface Catalog {
  vehicleTypes: { code: string; label: string }[];
  materials: { code: string; label: string }[];
}

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
export const STATUS_LABELS: Record<VerificationStatus, string> = {
  NOT_IN_YARD: "Không tìm thấy xe ở bãi",
  WAITING_CAPTURE: "Đang chờ ảnh chụp",
  WAITING_WEIGHT: "Chờ cân lần 1",
  WAITING_SECOND_WEIGH: "Chờ cân lần 2",
  VERIFIED: "Khớp",
  REVIEW_REQUIRED: "Cần xem lại",
  MISMATCH: "Không khớp",
  CAPTURE_FAILED: "Cần kiểm tra lại (ảnh chụp lỗi)"
};
const SHOT_QUALITY_LABELS: Record<CaptureAttempt["quality"], string> = { ok: "Đọc được", blurry: "Ảnh mờ", no_plate: "Không thấy biển" };
const RESOLUTION_LABELS: Record<Resolution, string> = { PENDING: "Chưa xử lý", CONFIRMED: "Đã xác nhận", REJECTED: "Đã từ chối" };
export const VISIT_LABELS: Record<VisitStatus, string> = { ENTERED: "Đã vào bãi", EXITED: "Đã ra khỏi bãi" };
const CHECK_LABELS: Record<CheckResult, string> = { pass: "ĐẠT", warn: "LƯU Ý", fail: "LỖI", skipped: "BỎ QUA" };
const SOURCE_LABELS: Record<Classification["source"], string> = {
  model: "AI model",
  "zero-shot": "AI ước lượng (CLIP)",
  operator: "Người vận hành",
  unavailable: "Chưa có model"
};

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/gate${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export const formatKg = (value: number | null): string => (value === null ? "—" : `${value.toLocaleString("vi-VN")} kg`);
export const formatTime = (value: string): string => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));

export interface WeighLeg {
  kg: number;
  at: string;
}

/**
 * Cân đầu vào / cân đầu ra theo thứ tự thời gian thực tế (không theo field gross/tare), vì xe có thể cân
 * rỗng lúc vào rồi cân đầy lúc ra (chở đá đi), hoặc ngược lại (chở hàng đến rồi cân rỗng lúc ra).
 */
export function weighLegs(weighing: GatePass["weighing"]): { entry: WeighLeg | null; exit: WeighLeg | null } {
  if (weighing === null) {
    return { entry: null, exit: null };
  }
  const legs: WeighLeg[] = [];
  if (weighing.grossKg !== null && weighing.grossAt !== null) {
    legs.push({ kg: weighing.grossKg, at: weighing.grossAt });
  }
  if (weighing.tareKg !== null && weighing.tareAt !== null) {
    legs.push({ kg: weighing.tareKg, at: weighing.tareAt });
  }
  legs.sort((first, second) => first.at.localeCompare(second.at));
  return { entry: legs[0] ?? null, exit: legs[1] ?? null };
}

function labelOf(items: { code: string; label: string }[] | undefined, code: string | null): string {
  if (code === null) {
    return "Chưa xác định";
  }
  return items?.find((item) => item.code === code)?.label ?? code;
}

const STEP_LABELS = ["Nhận xe", "Cân lượt một", "Cân lượt hai", "Chốt phiếu"];

/** Giai đoạn phiên cân hiện tại, suy ra từ dữ liệu thật (không có trạng thái mô phỏng riêng). */
function sessionStage(pass: GatePass): number {
  const legs = weighLegs(pass.weighing);
  if (legs.exit !== null) {
    return pass.resolution === "PENDING" ? 2 : 3;
  }
  return legs.entry !== null ? 1 : 0;
}

function StepTrack({ pass }: { pass: GatePass }): ReactElement {
  const stage = sessionStage(pass);
  return (
    <div className="step-track">
      {STEP_LABELS.map((label, index) => (
        <span className={index > stage ? "step-pending" : ""} key={label}>{String(index + 1).padStart(2, "0")} · {label}</span>
      ))}
    </div>
  );
}

const QUYET_DINH_LABELS: Record<Resolution, string> = { PENDING: "Chưa lưu phiếu", CONFIRMED: "Đã lưu phiếu", REJECTED: "Đã từ chối" };

/** Luồng hàng suy ra từ chênh lệch cân vào/ra: tăng cân = xuất hàng (chở đá đi), giảm cân = nhập hàng (trả hàng vào bãi). */
function luongHang(pass: GatePass): string {
  const legs = weighLegs(pass.weighing);
  if (legs.entry === null || legs.exit === null) {
    return "—";
  }
  return legs.exit.kg >= legs.entry.kg ? "Xuất hàng" : "Nhập hàng";
}

const CAMERA_STEPS = ["Nhận tín hiệu cân", "Yêu cầu camera chụp", "Nhận đủ ảnh", "Đối chiếu xong"];

/** Bước hiện tại của đợt chụp (1-4) — suy từ dữ liệu thật (captureAttempts/captureState/status), không phải mô phỏng giả. */
function captureStepCount(pass: GatePass): number {
  if (pass.captureAttempts.length === 0) {
    return 1;
  }
  if (pass.captureState === "pending") {
    return 2;
  }
  if (pass.status === "WAITING_WEIGHT" || pass.status === "WAITING_SECOND_WEIGH") {
    return 3;
  }
  return 4;
}

/**
 * "Bốn góc nhìn • một chuyến xe": lưới 2x2 ảnh từng camera trả về cho đợt chụp gần nhất (captureAttempts) —
 * dữ liệu thật (biển số/độ đọc được của từng camera), không phải ảnh minh hoạ tĩnh như bản mô phỏng cũ.
 * Luôn đủ CAPTURE_EXPECTED_SHOTS ô (mặc định 4); camera chưa trả ảnh hoặc ảnh lỗi thì hiện ô trống/ghi rõ lý do.
 */
export function CaptureGallery({ pass }: { pass: GatePass }): ReactElement {
  const step = captureStepCount(pass);
  const lightbox = useLightbox();
  return (
    <div className="panel gate-block sim-camera-panel">
      <p className="section-kicker">BỐN GÓC NHÌN · MỘT CHUYẾN XE</p>
      <div className="camera-grid">
        {pass.captureAttempts.map((attempt, index) => (
          <div className="camera-tile" key={`${attempt.cameraId}-${index}`}>
            <span className="sim-camera-badge">CẢNH MÔ PHỎNG</span>
            {attempt.imageUrl !== null ? (
              <button aria-label={`Xem to ${attempt.cameraId}`} className="camera-tile-button" onClick={() => lightbox.open(attempt.imageUrl!)} type="button">
                <img alt={attempt.cameraId} src={attempt.imageUrl} />
              </button>
            ) : (
              <div className="camera-tile-empty"><span>Không có ảnh</span></div>
            )}
            <p className="camera-caption">C{index + 1} · {attempt.cameraId} · {SHOT_QUALITY_LABELS[attempt.quality]}</p>
          </div>
        ))}
      </div>
      <div className="sim-step-track">
        {CAMERA_STEPS.map((label, index) => (
          <span className={index < step ? "sim-step-done" : ""} key={label}>{String(index + 1).padStart(2, "0")} · {label}</span>
        ))}
      </div>
      <p className="muted-text sim-camera-caption">
        {pass.status === "CAPTURE_FAILED"
          ? "Không camera nào đọc được biển số rõ ràng — sửa tay biển số/loại xe/loại đá ở khung bên cạnh."
          : "Camera cùng chụp khi trạm cân báo xong; hệ thống chọn ảnh đọc biển rõ nhất làm bằng chứng chính thức."}
      </p>
      <Lightbox url={lightbox.openUrl} onClose={lightbox.close} />
    </div>
  );
}

/** Khi editable=false (Trạm cân trực tiếp — chỉ xem): thông báo rõ phải vào Sổ cân & truy vết mới sửa/xác nhận được. */
function ViewOnlyNote({ pass }: { pass: GatePass }): ReactElement {
  if (pass.resolution !== "PENDING") {
    return <p className="muted-text">Lượt xe đã {RESOLUTION_LABELS[pass.resolution].toLowerCase()}.</p>;
  }
  return <p className="muted-text">Chỉ xem tại đây — vào <strong>Sổ cân &amp; truy vết</strong> để xác nhận, từ chối hoặc sửa biển số/loại xe/loại đá.</p>;
}

/** Thẻ "Phiên cân": số liệu tổng/bì/hàng, thông tin phiếu và thao tác xác nhận — khớp bố cục trong proposal.
 *  editable=false (Trạm cân trực tiếp): ẩn hẳn nút/ô sửa, chỉ còn xem — sửa chuyển sang Sổ cân & truy vết. */
export function PhienCanPanel({ pass, catalog, offline, editable = true }: { pass: GatePass; catalog: Catalog | undefined; offline?: boolean; editable?: boolean }): ReactElement {
  const w = pass.weighing;
  const ticketCode = w?.ticketNo ?? pass.id.slice(0, 8).toUpperCase();
  const lightbox = useLightbox();
  return (
    <div className="panel gate-block">
      <div className="panel-heading">
        <div><p className="section-kicker">PHIÊN CÂN</p><h2>{ticketCode}</h2></div>
        <span className={`status-pill ${pass.resolution === "PENDING" ? "gate-waiting_weight" : "gate-verified"}`}>{pass.resolution === "PENDING" ? "Đang xử lý" : "Hoàn tất"}</span>
      </div>
      <div className="stat-grid">
        <div className="stat-box"><p className="stat-label">Cân tổng / kg</p><p className="stat-value">{w?.grossKg === null || w?.grossKg === undefined ? "—" : w.grossKg.toLocaleString("vi-VN")}</p></div>
        <div className="stat-box"><p className="stat-label">Cân bì / kg</p><p className="stat-value">{w?.tareKg === null || w?.tareKg === undefined ? "—" : w.tareKg.toLocaleString("vi-VN")}</p></div>
        <div className="stat-box"><p className="stat-label">Hàng / kg</p><p className="stat-value">{w?.netKg === null || w?.netKg === undefined ? "—" : w.netKg.toLocaleString("vi-VN")}</p></div>
      </div>
      <StepTrack pass={pass} />
      <dl className="session-facts">
        <div><dt>Biển số mẫu</dt><dd>{w?.plateNumber ?? pass.effective.plateNumber}</dd></div>
        <div><dt>Luồng hàng</dt><dd>{luongHang(pass)}</dd></div>
        <div><dt>Theo lệnh</dt><dd>{labelOf(catalog?.materials, pass.effective.material)}</dd></div>
        <div><dt>Nhận dạng</dt><dd>{labelOf(catalog?.materials, pass.material.code)}</dd></div>
        <div><dt>Quyết định</dt><dd>{QUYET_DINH_LABELS[pass.resolution]}</dd></div>
      </dl>
      {(pass.capture.imageUrl !== null || pass.exitCapture?.imageUrl != null) && (
        <div className="capture-image-row">
          {pass.capture.imageUrl !== null && (
            <button className="capture-image-link" onClick={() => lightbox.open(pass.capture.imageUrl as string)} type="button">
              <img alt="Ảnh chụp lúc vào" loading="lazy" src={pass.capture.imageUrl} />
              <span>Ảnh lúc vào</span>
            </button>
          )}
          {pass.exitCapture?.imageUrl != null && (
            <button className="capture-image-link" onClick={() => lightbox.open(pass.exitCapture!.imageUrl as string)} type="button">
              <img alt="Ảnh chụp lúc ra" loading="lazy" src={pass.exitCapture.imageUrl} />
              <span>Ảnh lúc ra</span>
            </button>
          )}
        </div>
      )}
      <Lightbox url={lightbox.openUrl} onClose={lightbox.close} />
      {pass.statusReasons.length > 0 && (
        <ul className="status-reasons" aria-label="Lý do trạng thái">
          {pass.statusReasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {offline === true && <p className="offline-note">Tiếp tục lưu tại trạm. Phiếu được đồng bộ khi kết nối trở lại.</p>}
      {editable ? <ResolvePanel key={pass.id} catalog={catalog} pass={pass} /> : <ViewOnlyNote pass={pass} />}
      {w !== null && (
        <div className="ticket-summary">
          <strong>PHIẾU {ticketCode} · {formatKg(w.netKg)}</strong>
          <p>{labelOf(catalog?.materials, pass.effective.material)} · Tổng {formatKg(w.grossKg)} – Bì {formatKg(w.tareKg)}</p>
          <p>{offline === true ? "Đã lưu tại trạm • Chờ đồng bộ" : w.source === "mock" ? "Cân giả lập (chờ nối trạm cân thật)" : `Trạm ${w.scaleId}`}</p>
        </div>
      )}
    </div>
  );
}

export function ResolvePanel({ pass, catalog }: { pass: GatePass; catalog: Catalog | undefined }): ReactElement {
  const queryClient = useQueryClient();
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [material, setMaterial] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (decision: "confirm" | "reject") =>
      postJson<GatePass>(`/passes/${pass.id}/${decision}`, {
        plateNumber: plate || undefined,
        vehicleType: vehicleType || undefined,
        material: material || undefined,
        reason: reason || undefined
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["gate-passes"] });
      // Sổ cân & truy vết (CapturesTable.tsx) dùng key riêng "gate-passes-table" — sửa/xác nhận từ modal ở đó
      // (xem EditModal) cần làm mới ngay, không đợi refetchInterval 3s.
      void queryClient.invalidateQueries({ queryKey: ["gate-passes-table"] });
    },
    onError: (failure: unknown) => setError(failure instanceof Error ? failure.message : "Có lỗi xảy ra.")
  });

  if (pass.resolution !== "PENDING") {
    return <p className="muted-text">Lượt xe đã {RESOLUTION_LABELS[pass.resolution].toLowerCase()}.</p>;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
  };

  return (
    <form className="gate-resolve" onSubmit={handleSubmit}>
      <div className="gate-resolve-grid">
        <label>Sửa biển số<input placeholder={pass.effective.plateNumber} value={plate} onChange={(event) => setPlate(event.target.value)} /></label>
        <label>Sửa loại xe
          <select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)}>
            <option value="">Giữ nguyên</option>
            {catalog?.vehicleTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <label>Sửa loại đá
          <select value={material} onChange={(event) => setMaterial(event.target.value)}>
            <option value="">Giữ nguyên</option>
            {catalog?.materials.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <label>Lý do (bắt buộc khi từ chối, chỉnh sửa hoặc xác nhận lượt chưa khớp)
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error !== null && <p className="error-message">{error}</p>}
      <div className="gate-actions">
        <button className="secondary-button" disabled={pass.status !== "WAITING_SECOND_WEIGH"} title="Tự động ghi nhận khi xe lên cân lần hai tại trạm." type="button">Ghi lượt cân thứ hai</button>
        <button className="primary-button" disabled={mutation.isPending || pass.status === "WAITING_WEIGHT" || pass.status === "WAITING_SECOND_WEIGH"} type="button" onClick={() => mutation.mutate("confirm")}>Chốt phiếu cân</button>
        <button className="danger-button" disabled={mutation.isPending} type="button" onClick={() => mutation.mutate("reject")}>Từ chối</button>
      </div>
    </form>
  );
}


export function PassDetail({ pass, catalog, offline, editable = true }: { pass: GatePass; catalog: Catalog | undefined; offline?: boolean; editable?: boolean }): ReactElement {
  const selected = pass;
  return (
    <div className="live-details">
            <div className="panel gate-block">
              <div className="panel-heading">
                <div><p className="section-kicker">LƯỢT XE</p><h2>{selected.effective.plateNumber}</h2></div>
                <div className="heading-actions">
                  <span className={`status-pill visit-${selected.visitStatus.toLowerCase()}`}>{VISIT_LABELS[selected.visitStatus]}</span>
                  <span className={`status-pill gate-${selected.status.toLowerCase()}`}>{STATUS_LABELS[selected.status]}</span>
                  <span className="result-count">{RESOLUTION_LABELS[selected.resolution]}</span>
                </div>
              </div>
              <dl className="gate-facts">
                <div><dt>Biển số (camera)</dt><dd>{selected.capture.plateText}</dd></div>
                <div><dt>Độ tin cậy OCR</dt><dd>{selected.capture.ocrConfidence === null ? "—" : `${Math.round(selected.capture.ocrConfidence * 100)}%`}</dd></div>
                <div><dt>Nguồn loại xe / loại hàng</dt><dd>{SOURCE_LABELS[selected.vehicleType.source]} · {SOURCE_LABELS[selected.material.source]}</dd></div>
                <div><dt>Tài xế</dt><dd>{selected.master.drivers.length === 0 ? "—" : selected.master.drivers.map((driver) => driver.fullName).join(", ")}{selected.master.match !== "none" && <small>Xe trong bãi: {selected.master.plateNumber}{selected.master.match === "near" ? " (gần giống)" : ""}</small>}</dd></div>
                <div><dt>Camera</dt><dd>{selected.capture.cameraId}</dd></div>
                <div><dt>Thời điểm chụp</dt><dd>{formatTime(selected.capture.capturedAt)}</dd></div>
              </dl>
            </div>

            <div className="live-panels">
              <PhienCanPanel catalog={catalog} editable={editable} offline={offline} pass={selected} />
            </div>

            <div className="panel gate-block">
              <p className="section-kicker">WEIGHBRIDGE</p>
              {selected.weighing === null ? (
                <p className="muted-text">Chưa nhận số liệu cân khớp với lượt xe này.</p>
              ) : (
                <dl className="gate-facts">
                  <div><dt>Phiếu / trạm</dt><dd>{selected.weighing.ticketNo ?? "—"} · {selected.weighing.scaleId}{selected.weighing.source === "mock" && <small>Cân giả lập (random khi chụp)</small>}</dd></div>
                  <div><dt>Biển số trên phiếu</dt><dd>{selected.weighing.plateNumber ?? "—"}</dd></div>
                  <div><dt>Thời điểm cân tổng</dt><dd>{selected.weighing.grossAt === null ? "—" : formatTime(selected.weighing.grossAt)}</dd></div>
                  <div><dt>Thời điểm cân bì</dt><dd>{selected.weighing.tareAt === null ? "Xe còn trong bãi" : formatTime(selected.weighing.tareAt)}</dd></div>
                </dl>
              )}
            </div>

            <div className="panel gate-block">
              <p className="section-kicker">KIỂM TRA CHÉO</p>
              <ul className="gate-checks">
                {selected.checks.map((check) => (
                  <li key={check.code}><span className={`check-badge check-${check.result}`}>{CHECK_LABELS[check.result]}</span><strong>{check.label}</strong><small>{check.detail}</small></li>
                ))}
              </ul>
            </div>

            <div className="panel gate-block">
              <p className="section-kicker">NHẬT KÝ</p>
              <ul className="gate-audit">
                {selected.audit.map((entry, index) => (
                  <li key={`${entry.at}-${entry.action}-${index}`}><small>{formatTime(entry.at)}</small> <strong>{entry.action}</strong> · {entry.actor}{entry.reason !== null && <> — {entry.reason}</>}</li>
                ))}
              </ul>
            </div>
    </div>
  );
}

export function useGateCatalog(): Catalog | undefined {
  return useQuery({ queryKey: ["gate-catalog"], queryFn: () => request<Catalog>("/catalog"), staleTime: Infinity }).data;
}

type GateEvent = { type: "upsert"; pass: GatePass } | { type: "remove"; id: string };
const byCapturedAtDesc = (first: GatePass, second: GatePass): number => second.capture.capturedAt.localeCompare(first.capture.capturedAt);

/** Nguồn dữ liệu lượt xe dùng chung cho mọi trang: tải danh sách rồi giữ đồng bộ qua SSE. Một phiên đăng ký cho cả ứng dụng. */
export function useGateFeed(): { rows: GatePass[]; connected: boolean; message: string | null } {
  const [rows, setRows] = useState<GatePass[]>([]);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void request<GatePass[]>("/passes")
      .then((passes) => {
        if (!cancelled) {
          // Gộp với sự kiện đã tới trong lúc tải để không mất dòng nào.
          setRows((current) => [...current, ...passes.filter((pass) => !current.some((row) => row.id === pass.id))].sort(byCapturedAtDesc));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Không tải được danh sách lượt xe.");
        }
      });
    const source = new EventSource(`${API_BASE_URL}/live/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as GateEvent;
        if (payload.type !== "remove" && payload.type !== "upsert") {
          return;
        }
        setRows((current) =>
          payload.type === "remove"
            ? current.filter((row) => row.id !== payload.id)
            : [payload.pass, ...current.filter((row) => row.id !== payload.pass.id)].sort(byCapturedAtDesc)
        );
      } catch (error: unknown) {
        setMessage(error instanceof Error ? `SSE không hợp lệ: ${error.message}` : "SSE trả về dữ liệu không hợp lệ.");
      }
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return { rows, connected, message };
}
