import { ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STATUS_LABELS, VISIT_LABELS, formatKg, formatTime, request, useGateCatalog, weighLegs } from "./PassDetail";
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

/** yyyy-mm-dd theo giờ máy người dùng, khớp giá trị của <input type="date">. */
function localDate(value: string): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const CSV_HEADERS = [
  "Thời gian chụp", "Biển số", "Ra/Vào", "Tài xế", "Loại xe", "Loại đá",
  "Cân đầu vào (kg)", "Cân đầu ra (kg)", "Đá net (kg)", "Trạng thái", "Lý do"
];

const SAMPLE_TICKETS = [
  { ticket: "MD-014", site: "Mỏ đá", material: "Đá 2–3", grossKg: 38_760, tareKg: 12_480, netKg: 26_280 },
  { ticket: "MC-008", site: "Mỏ cát", material: "Cát", grossKg: 36_000, tareKg: 12_000, netKg: 24_000 },
  { ticket: "BT-006", site: "Cơ sở bê tông", material: "Đá 4–6", grossKg: 39_000, tareKg: 12_500, netKg: 26_500 },
  { ticket: "MC-001", site: "Mỏ đá", material: "Đá 2–3", grossKg: 38_760, tareKg: 12_480, netKg: 26_280 },
  { ticket: "MC-002", site: "Mỏ đá", material: "Đá 2–3", grossKg: 38_760, tareKg: 12_480, netKg: 26_280 }
];

interface ClearResult {
  removed: number;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function driverCsvText(row: GatePass): string {
  if (row.master.match === "none" || row.master.drivers.length === 0) {
    return "";
  }
  return row.master.drivers.map((driver) => driver.fullName).join("; ");
}

function exportCsv(rows: GatePass[], catalog: Catalog | undefined): void {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
    const legs = weighLegs(row.weighing);
    lines.push([
      formatTime(row.capture.capturedAt),
      row.effective.plateNumber,
      VISIT_LABELS[row.visitStatus],
      driverCsvText(row),
      labelOf(catalog?.vehicleTypes, row.effective.vehicleType),
      labelOf(catalog?.materials, row.effective.material),
      legs.entry === null ? "" : String(legs.entry.kg),
      legs.exit === null ? "" : String(legs.exit.kg),
      row.weighing?.netKg === null || row.weighing?.netKg === undefined ? "" : String(row.weighing.netKg),
      STATUS_LABELS[row.status],
      row.statusReasons.join("; ")
    ].map(csvCell).join(","));
  }
  // BOM để Excel đọc đúng tiếng Việt UTF-8.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `so-can-truy-vet_${localDate(new Date().toISOString())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSampleTicketsCsv(): void {
  const lines = [["Phiếu", "Cơ sở", "Vật liệu", "Tổng (kg)", "Bì (kg)", "Hàng (kg)", "Đồng bộ"].join(",")];
  for (const row of SAMPLE_TICKETS) {
    lines.push([row.ticket, row.site, row.material, row.grossKg, row.tareKg, row.netKg, "Đã đồng bộ"].map((value) => csvCell(String(value))).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "so-can-truy-vet_mo-phong.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** Sổ cân rút gọn theo đúng bố cục proposal: một dòng một phiếu, không có ảnh. "Đồng bộ" suy từ quyết định — chưa có kênh đồng bộ thật. */
function SummarySheet(): ReactElement {
  return (
    <div className="sheet-wrap">
      <table className="sheet compact">
        <thead>
          <tr>
            <th>Phiếu</th>
            <th>Cơ sở</th>
            <th>Vật liệu</th>
            <th>Tổng (kg)</th>
            <th>Bì (kg)</th>
            <th>Hàng (kg)</th>
            <th>Đồng bộ</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_TICKETS.map((row) => (
            <tr key={row.ticket}>
              <td className="cell-plate">{row.ticket}</td>
              <td>{row.site}</td>
              <td>{row.material}</td>
              <td className="cell-num">{row.grossKg.toLocaleString("vi-VN")}</td>
              <td className="cell-num">{row.tareKg.toLocaleString("vi-VN")}</td>
              <td className="cell-num"><strong>{row.netKg.toLocaleString("vi-VN")}</strong></td>
              <td><span className="status-pill gate-verified">Đã đồng bộ</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sổ cân & truy vết: tóm tắt theo bố cục proposal, hoặc bảng đầy đủ mọi cột số liệu của lượt xe. */
export default function CapturesTable(): ReactElement {
  const catalog = useGateCatalog();
  const passesQuery = useQuery({ queryKey: ["gate-passes-table"], queryFn: () => request<GatePass[]>("/passes"), refetchInterval: 3000 });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"summary" | "full">("summary");
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const clear = useMutation({
    mutationFn: (scope: "resolved" | "all") => request<ClearResult>(`/passes?scope=${scope}`, { method: "DELETE" }),
    onSuccess: (result) => {
      setClearMessage(`Đã xoá ${result.removed} lượt.`);
      void queryClient.invalidateQueries({ queryKey: ["gate-passes-table"] });
    },
    onError: (error: unknown) => setClearMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.")
  });
  const confirmClear = (scope: "resolved" | "all", question: string): void => {
    if (window.confirm(question)) {
      clear.mutate(scope);
    }
  };
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
  const resolvedCount = allRows.filter((row) => row.resolution !== "PENDING").length;

  return (
    <section className={`panel captures-page ${tab === "summary" ? "captures-summary" : "captures-full"}`}>
      <div className="panel-heading">
        <div><h2>Sổ cân theo chuyến xe</h2><p className="muted-text captures-description">Dữ liệu minh họa. Phiếu mới được thêm sau khi chốt mô phỏng.</p></div>
      </div>
      <div className="view-tabs captures-extra">
        <button aria-pressed={tab === "summary"} className="tab-button" type="button" onClick={() => setTab("summary")}>Tóm tắt</button>
        <button aria-pressed={tab === "full"} className="tab-button" type="button" onClick={() => setTab("full")}>Đầy đủ &amp; ảnh</button>
      </div>
      <div className="sheet-filter captures-extra">
        <label>Từ ngày<input max={toDate || undefined} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>Đến ngày<input min={fromDate || undefined} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button type="button" onClick={() => { setFromDate(today); setToDate(today); }}>Hôm nay</button>
        <button disabled={!filtered} type="button" onClick={() => { setFromDate(""); setToDate(""); }}>Bỏ lọc</button>
        <button className="primary-button" disabled={rows.length === 0} type="button" onClick={() => exportCsv(rows, catalog)}>Xuất CSV</button>
        <span className="muted-text">{rows.length} phiếu trong bộ dữ liệu</span>
      </div>
      <div className="captures-toolbar captures-extra">
        <button className="secondary-button" disabled={clear.isPending || resolvedCount === 0} type="button" onClick={() => confirmClear("resolved", `Xoá ${resolvedCount} lượt đã xác nhận/từ chối? Không thể hoàn tác.`)}>
          Clear đã xử lý ({resolvedCount})
        </button>
        <button className="danger-button" disabled={clear.isPending || allRows.length === 0} type="button" onClick={() => confirmClear("all", `Xoá TẤT CẢ ${allRows.length} lượt, kể cả lượt chưa xử lý, cùng nhật ký? Không thể hoàn tác.`)}>
          Clear tất cả
        </button>
      </div>
      {clearMessage !== null && <p className="muted-text">{clearMessage}</p>}
      {tab === "summary" ? (
        <>
          <SummarySheet />
          <div className="summary-export"><button className="primary-button" type="button" onClick={exportSampleTicketsCsv}>Xuất CSV</button><span className="muted-text">5 phiếu trong bộ dữ liệu</span></div>
          <p className="sim-banner">Phiếu lưu theo mã chuyến duy nhất. Chốt lặp không tạo bản ghi trùng. Lịch sử điều chỉnh giữ nội dung gốc và lý do.</p>
        </>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">◌</span>
          <h3>{filtered ? "Không có lượt nào trong khoảng ngày đã chọn" : "Chưa có lượt xe"}</h3>
          <p>{filtered ? "Đổi khoảng ngày hoặc bấm Bỏ lọc." : "Dữ liệu sẽ hiện ở đây khi trạm ghi nhận lượt mới."}</p>
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
                    <td className="cell-nowrap"><span className={`status-pill visit-${row.visitStatus.toLowerCase()}`}>{VISIT_LABELS[row.visitStatus]}</span></td>
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
