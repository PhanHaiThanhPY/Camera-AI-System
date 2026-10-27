import { ReactElement } from "react";
import { CaptureGallery, PassDetail, PhienCanPanel } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

/**
 * Trang riêng xem chi tiết + sửa một lượt xe (mở từ Sổ cân & truy vết, bấm vào dòng) — thay cho popup cũ
 * (quá nhỏ, khó nhìn). Cùng layout/thành phần với Trạm cân trực tiếp (CaptureGallery + PhienCanPanel) nhưng
 * full trang và CHO SỬA (editable mặc định true ở PhienCanPanel/PassDetail) — khác Trạm cân trực tiếp (chỉ xem).
 */
export default function PassPage({ pass, catalog, onBack }: { pass: GatePass | null; catalog: Catalog | undefined; onBack: () => void }): ReactElement {
  return (
    <section className="main-column">
      <button className="secondary-button back-button" type="button" onClick={onBack}>← Quay lại Sổ cân &amp; truy vết</button>
      {pass === null ? (
        <div className="panel hero-panel">
          <div className="empty-state">
            <span className="empty-icon">⚠</span>
            <h3>Không tìm thấy lượt xe</h3>
            <p>Lượt xe này có thể đã bị xoá hoặc chưa tải xong — quay lại Sổ cân &amp; truy vết rồi thử lại.</p>
          </div>
        </div>
      ) : pass.captureAttempts.length > 0 ? (
        <div className="simulation-result">
          <CaptureGallery pass={pass} />
          <PhienCanPanel catalog={catalog} pass={pass} />
        </div>
      ) : (
        <PassDetail catalog={catalog} pass={pass} />
      )}
    </section>
  );
}
