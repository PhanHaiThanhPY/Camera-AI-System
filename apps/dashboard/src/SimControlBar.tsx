import { ReactElement } from "react";

export const SCENARIOS = [
  { value: "stone-correct", label: "Xe đá 2–3 • đúng lệnh" },
  { value: "sand-correct", label: "Xe cát • đúng lệnh" },
  { value: "material-mismatch", label: "Xe đá • sai loại vật liệu" },
  { value: "scale-timeout", label: "Cân không phản hồi" }
] as const;

export interface SimState {
  scenario: string;
  setScenario: (value: string) => void;
  simRunning: boolean;
  run: () => void;
  reset: () => void;
  toggleLink: () => void;
  offline: boolean;
}

/**
 * Thanh điều khiển mô phỏng sự cố dùng chung cho cả 4 trang (đúng bố cục proposal). Chỉ đổi trạng thái UI cục bộ,
 * chưa nối vào luồng đồng bộ thật ở backend.
 */
export function SimControlBar({ sim }: { sim: SimState }): ReactElement {
  return (
    <div className="panel gate-block live-controlbar">
      <div className="live-controlbar-left">
        <select aria-label="Mỏ hoạt động" disabled title="Chưa có dữ liệu nhiều cơ sở">
          <option>Mỏ đá</option>
        </select>
        <select aria-label="Kịch bản mô phỏng sự cố" value={sim.scenario} onChange={(event) => sim.setScenario(event.target.value)}>
          {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="live-controlbar-left">
        <button className="primary-button" disabled={sim.simRunning} type="button" onClick={sim.run}>{sim.simRunning ? "Đang mô phỏng…" : "Chạy mô phỏng"}</button>
        <button className="secondary-button" type="button" onClick={sim.reset}>Đặt lại</button>
        <button className="secondary-button" type="button" onClick={sim.toggleLink}>{sim.offline ? "Kết nối lại" : "Ngắt mạng liên trạm"}</button>
      </div>
    </div>
  );
}
