import { FormEvent, ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type VerificationStatus = "NOT_IN_YARD" | "WAITING_WEIGHT" | "WAITING_SECOND_WEIGH" | "VERIFIED" | "REVIEW_REQUIRED" | "MISMATCH";
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
  videoJobId: string | null;
  mediaTimeSec: number | null;
  trail: [number, number, number, number, number][];
  cameraId: string;
  capturedAt: string;
  overviewUrl: string | null;
  plateCropUrl: string | null;
  vehicleImageUrl: string | null;
  loadImageUrl: string | null;
  vehicleBox: { box: [number, number, number, number]; source: string } | null;
  loadBox: { box: [number, number, number, number]; source: string } | null;
  plateText: string;
  ocrConfidence: number | null;
  detectorConfidence: number | null;
  plateRegion: { points: [number, number][]; source: string } | null;
}

export interface GatePass {
  master: MasterLink;
  id: string;
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
  visitStatus: VisitStatus | null;
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
  WAITING_WEIGHT: "Chờ cân lần 1",
  WAITING_SECOND_WEIGH: "Chờ cân lần 2",
  VERIFIED: "Khớp",
  REVIEW_REQUIRED: "Cần xem lại",
  MISMATCH: "Không khớp"
};
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

const BOX_STYLES = { vehicle: "#f4d36f", load: "#f29a4a" } as const;

function CaptureOverlay({ capture }: { capture: PlateCapture }): ReactElement {
  const { plateRegion, vehicleBox, loadBox, overviewUrl, plateText } = capture;
  if (overviewUrl === null) {
    return (
      <div className="gate-frame gate-frame-empty">
        {capture.source === "weighbridge" ? "Lượt tạo thẳng từ số liệu cân, không qua camera." : "Chưa có ảnh toàn cảnh"}
      </div>
    );
  }
  const toRect = (box: [number, number, number, number]): { x: number; y: number; width: number; height: number } => ({
    x: box[0],
    y: box[1],
    width: box[2] - box[0],
    height: box[3] - box[1]
  });
  return (
    <div className="gate-frame">
      <img alt={`Toàn cảnh xe ${plateText}`} src={`${API_ORIGIN}${overviewUrl}`} />
      <svg aria-label="Vùng biển số, xe và hàng" preserveAspectRatio="none" role="img" viewBox="0 0 1 1">
        {vehicleBox !== null && <rect {...toRect(vehicleBox.box)} fill="none" stroke={BOX_STYLES.vehicle} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {loadBox !== null && <rect {...toRect(loadBox.box)} fill="none" stroke={BOX_STYLES.load} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {plateRegion !== null && <polygon points={plateRegion.points.map(([x, y]) => `${x},${y}`).join(" ")} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

function ImageTile({ label, url, alt }: { label: string; url: string | null; alt: string }): ReactElement {
  return (
    <figure className="image-tile">
      {url !== null ? <img alt={alt} loading="lazy" src={`${API_ORIGIN}${url}`} /> : <span>Chưa có ảnh</span>}
      <figcaption>{label}</figcaption>
    </figure>
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
        <button className="primary-button" disabled={mutation.isPending || pass.status === "WAITING_WEIGHT" || pass.status === "WAITING_SECOND_WEIGH"} type="button" onClick={() => mutation.mutate("confirm")}>Xác nhận cho qua</button>
        <button className="danger-button" disabled={mutation.isPending} type="button" onClick={() => mutation.mutate("reject")}>Từ chối</button>
      </div>
    </form>
  );
}


export function PassDetail({ pass, catalog }: { pass: GatePass; catalog: Catalog | undefined }): ReactElement {
  const selected = pass;
  const legs = weighLegs(selected.weighing);
  return (
    <>
            <div className="panel hero-panel">
              <div className="panel-heading">
                <div><p className="section-kicker">CAMERA + CÂN</p><h2>{selected.effective.plateNumber}</h2></div>
                <div className="heading-actions">
                  {selected.visitStatus !== null && <span className={`status-pill visit-${selected.visitStatus.toLowerCase()}`}>{VISIT_LABELS[selected.visitStatus]}</span>}
                  <span className={`status-pill gate-${selected.status.toLowerCase()}`}>{STATUS_LABELS[selected.status]}</span>
                  <span className="result-count">{RESOLUTION_LABELS[selected.resolution]}</span>
                </div>
              </div>
              {selected.statusReasons.length > 0 && (
                <ul className="status-reasons" aria-label="Lý do trạng thái">
                  {selected.statusReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <div className="capture-side">
                <p className="capture-side-label">LÚC VÀO · {formatTime(selected.capture.capturedAt)}</p>
                <CaptureOverlay capture={selected.capture} />
                <div className="image-tiles">
                  <ImageTile alt={`Ảnh biển số ${selected.capture.plateText}`} label="ẢNH BIỂN SỐ" url={selected.capture.plateCropUrl} />
                  <ImageTile alt="Ảnh xe" label="ẢNH XE" url={selected.capture.vehicleImageUrl} />
                  <ImageTile alt="Ảnh đá trên xe" label="ẢNH ĐÁ" url={selected.capture.loadImageUrl} />
                </div>
              </div>

              <div className="capture-side">
                <p className="capture-side-label">LÚC RA{selected.exitCapture !== null && <> · {formatTime(selected.exitCapture.capturedAt)}</>}</p>
                {selected.exitCapture === null ? (
                  <div className="gate-frame gate-frame-empty">{selected.visitStatus === "EXITED" ? "Chưa có ảnh lúc ra." : "Xe chưa ra khỏi bãi."}</div>
                ) : (
                  <>
                    <CaptureOverlay capture={selected.exitCapture} />
                    <div className="image-tiles">
                      <ImageTile alt={`Ảnh biển số lúc ra ${selected.exitCapture.plateText}`} label="ẢNH BIỂN SỐ" url={selected.exitCapture.plateCropUrl} />
                      <ImageTile alt="Ảnh xe lúc ra" label="ẢNH XE" url={selected.exitCapture.vehicleImageUrl} />
                      <ImageTile alt="Ảnh đá lúc ra" label="ẢNH ĐÁ" url={selected.exitCapture.loadImageUrl} />
                    </div>
                  </>
                )}
              </div>

              <dl className="gate-facts">
                <div><dt>Biển số (camera)</dt><dd>{selected.capture.plateText}</dd></div>
                <div><dt>Độ tin cậy OCR</dt><dd>{selected.capture.ocrConfidence === null ? "—" : `${Math.round(selected.capture.ocrConfidence * 100)}%`}</dd></div>
                <div><dt>Loại xe</dt><dd>{labelOf(catalog?.vehicleTypes, selected.effective.vehicleType)}<small>{SOURCE_LABELS[selected.vehicleType.source]}</small></dd></div>
                <div><dt>Loại đá</dt><dd>{labelOf(catalog?.materials, selected.effective.material)}<small>{SOURCE_LABELS[selected.material.source]}</small></dd></div>
                <div><dt>Tài xế</dt><dd>{selected.master.drivers.length === 0 ? "—" : selected.master.drivers.map((driver) => driver.fullName).join(", ")}{selected.master.match !== "none" && <small>Xe trong bãi: {selected.master.plateNumber}{selected.master.match === "near" ? " (gần giống)" : ""}</small>}</dd></div>
                <div><dt>Camera</dt><dd>{selected.capture.cameraId}</dd></div>
                <div><dt>Thời điểm chụp</dt><dd>{formatTime(selected.capture.capturedAt)}</dd></div>
              </dl>
            </div>

            <div className="panel gate-block">
              <p className="section-kicker">WEIGHBRIDGE</p>
              {selected.weighing === null ? (
                <p className="muted-text">Chưa nhận số liệu cân khớp với lượt xe này.</p>
              ) : (
                <dl className="gate-facts">
                  <div><dt>Phiếu / trạm</dt><dd>{selected.weighing.ticketNo ?? "—"} · {selected.weighing.scaleId}{selected.weighing.source === "mock" && <small>Cân giả lập (random khi chụp)</small>}</dd></div>
                  <div><dt>Biển số trên phiếu</dt><dd>{selected.weighing.plateNumber ?? "—"}</dd></div>
                  <div><dt>Cân đầu vào</dt><dd>{legs.entry === null ? "—" : formatKg(legs.entry.kg)}{legs.entry !== null && <small>{formatTime(legs.entry.at)}</small>}</dd></div>
                  <div><dt>Cân đầu ra</dt><dd>{legs.exit === null ? "Xe còn trong bãi" : formatKg(legs.exit.kg)}{legs.exit !== null && <small>{formatTime(legs.exit.at)}</small>}</dd></div>
                  <div><dt>Khối lượng đá (net)</dt><dd>{formatKg(selected.weighing.netKg)}</dd></div>
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
              <ResolvePanel key={selected.id} pass={selected} catalog={catalog} />
            </div>

            <div className="panel gate-block">
              <p className="section-kicker">NHẬT KÝ</p>
              <ul className="gate-audit">
                {selected.audit.map((entry, index) => (
                  <li key={`${entry.at}-${entry.action}-${index}`}><small>{formatTime(entry.at)}</small> <strong>{entry.action}</strong> · {entry.actor}{entry.reason !== null && <> — {entry.reason}</>}</li>
                ))}
              </ul>
            </div>
    </>
  );
}

export function useGateCatalog(): Catalog | undefined {
  return useQuery({ queryKey: ["gate-catalog"], queryFn: () => request<Catalog>("/catalog"), staleTime: Infinity }).data;
}
