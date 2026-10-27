import { ReactElement, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CaptureGallery, PassDetail, PhienCanPanel, formatTime, postJson } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

const VISIBLE_ROWS = 30;

/** Trạm cân trực tiếp: lượt xe mới nhất tại trạm, cập nhật realtime qua SSE khi worker xác nhận biển số/cân. */
export default function LivePage({ rows, catalog, message, offline }: { rows: GatePass[]; catalog: Catalog | undefined; message: string | null; offline: boolean }): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const simulate = useMutation({
    mutationFn: () => postJson<GatePass>("/simulate/weigh-and-capture", {}),
    onSuccess: (pass) => setSelectedId(pass.id),
    onError: () => undefined
  });

  return (
    <section className="main-column">
      <div className="panel gate-block live-controlbar">
        {rows.length > 1 && (
          <select aria-label="Chọn lượt xe" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
            {rows.slice(0, VISIBLE_ROWS).map((row) => (
              <option key={row.id} value={row.id}>{row.effective.plateNumber} · {formatTime(row.capture.capturedAt)}</option>
            ))}
          </select>
        )}
        <button className="secondary-button" disabled={simulate.isPending} title="Mô phỏng 1 xe đi qua trạm cân + camera chụp — không cần cân/camera thật." type="button" onClick={() => simulate.mutate()}>
          {simulate.isPending ? "Đang mô phỏng…" : "Mô phỏng cân + chụp"}
        </button>
        {simulate.isError && <span className="error-message">{simulate.error instanceof Error ? simulate.error.message : "Có lỗi xảy ra."}</span>}
      </div>
      {message !== null && <p className="muted-text">{message}</p>}
      {selected === null ? (
        <div className="panel hero-panel"><div className="empty-state"><span className="empty-icon">◌</span><h3>Chưa có lượt xe</h3><p>Ảnh biển số, xe, đá và cân nặng sẽ hiện ở đây ngay khi trạm ghi nhận lượt mới.</p></div></div>
      ) : selected.captureAttempts.length > 0 ? (
        <div className="simulation-result">
          <CaptureGallery pass={selected} />
          <PhienCanPanel catalog={catalog} editable={false} offline={offline} pass={selected} />
        </div>
      ) : (
        <PassDetail catalog={catalog} editable={false} offline={offline} pass={selected} />
      )}
    </section>
  );
}
