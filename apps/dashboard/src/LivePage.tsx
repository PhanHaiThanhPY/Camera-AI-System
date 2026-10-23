import { ReactElement, useState } from "react";
import { PassDetail, formatTime } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

const VISIBLE_ROWS = 30;
const SIM_STEPS = ["Nhận xe", "Cân lượt một", "Cân lượt hai", "Chốt phiếu"];
const SIM_CAMERAS = [
  { image: "/images/scale-simulation/truck-entry.png", label: "C1 · Toàn cảnh vào" },
  { image: "/images/scale-simulation/cargo-entry.png", label: "C2 · Cận cảnh vào" },
  { image: "/images/scale-simulation/truck-exit.png", label: "C3 · Toàn cảnh ra" },
  { image: "/images/scale-simulation/cargo-exit.png", label: "C4 · Cận cảnh ra" }
];

function SimulationCameras({ phase }: { phase: number }): ReactElement {
  return <div className="panel gate-block sim-camera-panel"><p className="section-kicker">BỐN GÓC NHÌN · MỘT CHUYẾN XE</p><div className="camera-grid">{SIM_CAMERAS.map((camera) => <div className="camera-tile" key={camera.image}><span className="sim-camera-badge">CẢNH MÔ PHỎNG</span><img alt={camera.label} src={camera.image} /><p className="camera-caption">{camera.label}</p></div>)}</div><div className="sim-step-track">{SIM_STEPS.map((step, index) => <span className={index < phase ? "sim-step-done" : ""} key={step}>{String(index + 1).padStart(2, "0")} · {step}</span>)}</div><p className="muted-text sim-camera-caption">C1/C3: toàn cảnh xe vào và ra · C2/C4: ảnh hàng trên xe ở hai lượt cân.</p></div>;
}

function SimulationResult({ template, phase, scenario, offline, committed, onCommit }: { template: GatePass | null; phase: number; scenario: string; offline: boolean; committed: boolean; onCommit: () => void }): ReactElement {
  const material = scenario.includes("sand") ? "Cát" : "Đá 2–3";
  const detectedMaterial = scenario.includes("mismatch") ? "Đá 4–6" : material;
  const values = ["Xe vào trạm", "Đã nhận lượt cân", "Đã nhận lượt hai", "Đủ điều kiện chốt"];
  return (
    <div className="simulation-result">
      <SimulationCameras phase={phase} />
      <div className="panel gate-block sim-session">
        <div className="panel-heading"><div><p className="section-kicker">PHIÊN CÂN</p><h2>MC-001</h2></div><span className={`status-pill ${phase === 4 ? "gate-verified" : "gate-waiting_weight"}`}>{phase === 4 ? "Đã nhận lượt hai" : "Đang mô phỏng"}</span></div>
        <div className="stat-grid">
          <div className="stat-box"><p className="stat-label">Cân tổng / kg</p><p className="stat-value">{phase >= 3 ? "38.760" : "—"}</p></div>
          <div className="stat-box"><p className="stat-label">Cân bì / kg</p><p className="stat-value">{phase >= 2 ? "12.480" : "—"}</p></div>
          <div className="stat-box"><p className="stat-label">Hàng / kg</p><p className="stat-value">{phase >= 3 ? "26.280" : "—"}</p></div>
        </div>
        <dl className="session-facts">
          <div><dt>Biển số mẫu</dt><dd>{template?.effective.plateNumber ?? "51C-000.01"}</dd></div>
          <div><dt>Luồng hàng</dt><dd>Xuất hàng</dd></div>
          <div><dt>Theo lệnh</dt><dd>{material}</dd></div>
          <div><dt>Nhận dạng</dt><dd>{detectedMaterial}</dd></div>
          <div><dt>Quyết định</dt><dd>{scenario.includes("mismatch") && phase === 4 ? "Cần kiểm tra vật liệu" : phase === 4 ? "Đủ điều kiện chốt" : values[Math.max(0, phase - 1)]}</dd></div>
        </dl>
        {offline && <p className="offline-note">Mất kết nối liên trạm. Dữ liệu mô phỏng vẫn được giữ tại màn hình này.</p>}
        {phase === 4 && <p className="sim-complete-note">{committed ? "Phiếu mô phỏng đã được chốt." : "Hồ sơ đã ghép đúng xe, hai lượt cân và ảnh tương ứng."}</p>}
        <div className="gate-actions sim-actions"><button className="secondary-button" disabled type="button">{phase >= 3 ? "Đã ghi lượt cân thứ hai" : "Chờ lượt cân thứ hai"}</button><button className="primary-button" disabled={phase < 4 || committed || scenario.includes("mismatch")} onClick={onCommit} type="button">{scenario.includes("mismatch") ? "Chờ xác nhận vật liệu" : committed ? "Đã chốt phiếu cân" : "Chốt phiếu cân"}</button></div>
      </div>
    </div>
  );
}

/** Trạm cân trực tiếp: lượt xe mới nhất tại trạm, cập nhật realtime qua SSE khi worker xác nhận biển số/cân. */
export default function LivePage({ rows, catalog, message, offline, simulationPhase, scenario }: { rows: GatePass[]; catalog: Catalog | undefined; message: string | null; offline: boolean; simulationPhase: number; scenario: string }): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  return (
    <section className="main-column">
      {rows.length > 1 && (
        <div className="panel gate-block live-controlbar">
          <select aria-label="Chọn lượt xe" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
            {rows.slice(0, VISIBLE_ROWS).map((row) => (
              <option key={row.id} value={row.id}>{row.effective.plateNumber} · {formatTime(row.capture.capturedAt)}</option>
            ))}
          </select>
        </div>
      )}
      {message !== null && <p className="muted-text">{message}</p>}
      {simulationPhase > 0 ? <SimulationResult committed={committed && simulationPhase > 0} onCommit={() => setCommitted(true)} offline={offline} phase={simulationPhase} scenario={scenario} template={selected} /> : selected === null ? (
        <div className="panel hero-panel"><div className="empty-state"><span className="empty-icon">◌</span><h3>Chưa có lượt xe</h3><p>Ảnh biển số, xe, đá và cân nặng sẽ hiện ở đây ngay khi trạm ghi nhận lượt mới.</p></div></div>
      ) : (
        <PassDetail catalog={catalog} offline={offline} pass={selected} />
      )}
    </section>
  );
}
