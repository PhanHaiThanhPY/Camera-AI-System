import { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_ORIGIN, STATUS_LABELS, formatKg, formatTime, request, useGateCatalog } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

const labelOf = (items: Catalog["vehicleTypes"] | undefined, code: string | null): string =>
  code === null ? "—" : (items?.find((item) => item.code === code)?.label ?? code);

function ImageCell({ url, alt }: { url: string | null; alt: string }): ReactElement {
  if (url === null) {
    return <td className="cell-empty">—</td>;
  }
  const src = `${API_ORIGIN}${url}`;
  return (
    <td className="cell-image">
      <a href={src} rel="noreferrer" target="_blank" title="Mở ảnh gốc">
        <img alt={alt} loading="lazy" src={src} />
      </a>
    </td>
  );
}

/** Bảng kiểu Excel: mỗi dòng một lượt xe, mỗi loại ảnh một cột. */
export default function CapturesTable(): ReactElement {
  const catalog = useGateCatalog();
  const passesQuery = useQuery({ queryKey: ["gate-passes-table"], queryFn: () => request<GatePass[]>("/passes"), refetchInterval: 3000 });
  const rows = passesQuery.data ?? [];

  return (
    <section className="panel captures-page">
      <div className="panel-heading">
        <div><p className="section-kicker">DANH SÁCH</p><h2>Ảnh đã chụp</h2></div>
        <span className="count-badge">{rows.length} lượt</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state"><span className="empty-icon">◌</span><h3>Chưa có ảnh chụp</h3><p>Vào menu Realtime, chọn video để nhận diện.</p></div>
      ) : (
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>#</th>
                <th>Thời gian chụp</th>
                <th>Biển số</th>
                <th>Ảnh biển số</th>
                <th>Ảnh xe</th>
                <th>Ảnh đá</th>
                <th>Ảnh toàn cảnh</th>
                <th>Loại xe</th>
                <th>Loại đá</th>
                <th>Cân lần 1 (gross)</th>
                <th>Cân lần 2 (tare)</th>
                <th>Hàng (net)</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="cell-num">{rows.length - index}</td>
                  <td className="cell-nowrap">{formatTime(row.capture.capturedAt)}</td>
                  <td className="cell-plate">{row.effective.plateNumber}</td>
                  <ImageCell alt={`Ảnh biển số ${row.effective.plateNumber}`} url={row.capture.plateCropUrl} />
                  <ImageCell alt={`Ảnh xe ${row.effective.plateNumber}`} url={row.capture.vehicleImageUrl} />
                  <ImageCell alt={`Ảnh đá trên xe ${row.effective.plateNumber}`} url={row.capture.loadImageUrl} />
                  <ImageCell alt={`Toàn cảnh ${row.effective.plateNumber}`} url={row.capture.overviewUrl} />
                  <td>{labelOf(catalog?.vehicleTypes, row.effective.vehicleType)}</td>
                  <td>{labelOf(catalog?.materials, row.effective.material)}</td>
                  <td className="cell-num">{formatKg(row.weighing?.grossKg ?? null)}</td>
                  <td className="cell-num">{formatKg(row.weighing?.tareKg ?? null)}</td>
                  <td className="cell-num">{formatKg(row.weighing?.netKg ?? null)}</td>
                  <td><span className={`status-pill gate-${row.status.toLowerCase()}`}>{STATUS_LABELS[row.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
