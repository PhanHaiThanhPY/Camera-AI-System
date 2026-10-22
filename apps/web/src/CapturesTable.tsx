import { ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_ORIGIN, STATUS_LABELS, VISIT_LABELS, formatKg, formatTime, postJson, request, useGateCatalog, weighLegs } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

const labelOf = (items: Catalog["vehicleTypes"] | undefined, code: string | null): string =>
  code === null ? "—" : (items?.find((item) => item.code === code)?.label ?? code);

function driverText(row: GatePass): ReactElement | string {
  if (row.master.match === "none") {
    return "—";
  }
  if (row.master.drivers.length === 0) {
    return <span className="muted-text">Chưa có tài xế</span>;
  }
  return (
    <>
      {row.master.drivers.map((driver) => (
        <div key={driver.id}>{driver.fullName}{driver.phone !== "" && <small className="cell-sub"> {driver.phone}</small>}{driver.isPrimary && row.master.drivers.length > 1 && <small className="cell-sub"> (chính)</small>}</div>
      ))}
    </>
  );
}

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

/** yyyy-mm-dd theo giờ máy người dùng, khớp giá trị của <input type="date">. */
function localDate(value: string): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Bảng kiểu Excel: mỗi dòng một lượt xe, mỗi loại ảnh một cột. */
export default function CapturesTable(): ReactElement {
  const catalog = useGateCatalog();
  const passesQuery = useQuery({ queryKey: ["gate-passes-table"], queryFn: () => request<GatePass[]>("/passes"), refetchInterval: 3000 });
  const queryClient = useQueryClient();
  const [reclassifyMessage, setReclassifyMessage] = useState<string | null>(null);
  const reclassify = useMutation({
    mutationFn: () => postJson<{ checked: number; classified: number; removedNotCargo: number }>("/passes/reclassify-materials", {}),
    onSuccess: (result) => {
      setReclassifyMessage(`Đã kiểm tra ${result.checked} ảnh: nhận được loại đá cho ${result.classified}, bỏ ${result.removedNotCargo} ảnh không phải thùng hàng.`);
      void queryClient.invalidateQueries({ queryKey: ["gate-passes-table"] });
    },
    onError: (error: unknown) => setReclassifyMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.")
  });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const allRows = passesQuery.data ?? [];
  // Chuỗi yyyy-mm-dd so sánh theo thứ tự chữ cái đúng thứ tự ngày.
  const rows = allRows.filter((row) => {
    const day = localDate(row.capture.capturedAt);
    return (fromDate === "" || day >= fromDate) && (toDate === "" || day <= toDate);
  });
  const filtered = fromDate !== "" || toDate !== "";
  const today = localDate(new Date().toISOString());

  return (
    <section className="panel captures-page">
      <div className="panel-heading">
        <div><p className="section-kicker">DANH SÁCH</p><h2>Ảnh đã chụp</h2></div>
        <span className="count-badge">{filtered ? `${rows.length}/${allRows.length}` : rows.length} lượt</span>
      </div>
      <div className="sheet-filter">
        <label>Từ ngày<input max={toDate || undefined} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>Đến ngày<input min={fromDate || undefined} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button type="button" onClick={() => { setFromDate(today); setToDate(today); }}>Hôm nay</button>
        <button disabled={!filtered} type="button" onClick={() => { setFromDate(""); setToDate(""); }}>Bỏ lọc</button>
        <button disabled={reclassify.isPending} type="button" onClick={() => reclassify.mutate()}>{reclassify.isPending ? "Đang phân loại…" : "Phân loại lại loại đá"}</button>
      </div>
      {reclassifyMessage !== null && <p className="muted-text">{reclassifyMessage}</p>}
      {rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">◌</span>
          <h3>{filtered ? "Không có ảnh trong khoảng ngày đã chọn" : "Chưa có ảnh chụp"}</h3>
          <p>{filtered ? "Đổi khoảng ngày hoặc bấm Bỏ lọc." : "Vào menu Realtime, chọn video để nhận diện."}</p>
        </div>
      ) : (
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th>#</th>
                <th>Thời gian chụp</th>
                <th>Biển số</th>
                <th>Ra / Vào</th>
                <th>BS · vào</th>
                <th>Xe · vào</th>
                <th>Đá · vào</th>
                <th>Cảnh · vào</th>
                <th>BS · ra</th>
                <th>Xe · ra</th>
                <th>Đá · ra</th>
                <th>Cảnh · ra</th>
                <th>Tài xế</th>
                <th>Loại xe</th>
                <th>Loại đá</th>
                <th>Cân đầu vào</th>
                <th>Cân đầu ra</th>
                <th>Đá (net)</th>
                <th>Trạng thái</th>
                <th>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const legs = weighLegs(row.weighing);
                return (
                  <tr key={row.id}>
                    <td className="cell-num">{rows.length - index}</td>
                    <td className="cell-nowrap">{formatTime(row.capture.capturedAt)}</td>
                    <td className="cell-plate">{row.effective.plateNumber}</td>
                    <td className="cell-nowrap">{row.visitStatus === null ? "—" : <span className={`status-pill visit-${row.visitStatus.toLowerCase()}`}>{VISIT_LABELS[row.visitStatus]}</span>}</td>
                    <ImageCell alt={`Ảnh biển số lúc vào ${row.effective.plateNumber}`} url={row.capture.plateCropUrl} />
                    <ImageCell alt={`Ảnh xe lúc vào ${row.effective.plateNumber}`} url={row.capture.vehicleImageUrl} />
                    <ImageCell alt={`Ảnh đá lúc vào ${row.effective.plateNumber}`} url={row.capture.loadImageUrl} />
                    <ImageCell alt={`Toàn cảnh lúc vào ${row.effective.plateNumber}`} url={row.capture.overviewUrl} />
                    <ImageCell alt={`Ảnh biển số lúc ra ${row.effective.plateNumber}`} url={row.exitCapture?.plateCropUrl ?? null} />
                    <ImageCell alt={`Ảnh xe lúc ra ${row.effective.plateNumber}`} url={row.exitCapture?.vehicleImageUrl ?? null} />
                    <ImageCell alt={`Ảnh đá lúc ra ${row.effective.plateNumber}`} url={row.exitCapture?.loadImageUrl ?? null} />
                    <ImageCell alt={`Toàn cảnh lúc ra ${row.effective.plateNumber}`} url={row.exitCapture?.overviewUrl ?? null} />
                    <td className="cell-nowrap">{driverText(row)}</td>
                    <td>{labelOf(catalog?.vehicleTypes, row.effective.vehicleType)}</td>
                    <td>{labelOf(catalog?.materials, row.effective.material)}</td>
                    <td className="cell-num">{legs.entry === null ? "—" : formatKg(legs.entry.kg)}</td>
                    <td className="cell-num">{legs.exit === null ? "—" : formatKg(legs.exit.kg)}</td>
                    <td className="cell-num">{formatKg(row.weighing?.netKg ?? null)}</td>
                    <td><span className={`status-pill gate-${row.status.toLowerCase()}`}>{STATUS_LABELS[row.status]}</span></td>
                    <td className="cell-reasons">{row.statusReasons.length === 0 ? "—" : row.statusReasons.map((reason) => <div key={reason}>{reason}</div>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
