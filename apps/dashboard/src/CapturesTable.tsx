import { ChangeEvent, MouseEvent, ReactElement, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { API_BASE_URL, Lightbox, STATUS_LABELS, VISIT_LABELS, formatKg, formatTime, request, siteQuery, useGateCatalog, useLightbox, weighLegs } from "./PassDetail";
import type { Catalog, GatePass } from "./PassDetail";

interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

const labelOf = (items: Catalog["vehicleTypes"] | undefined, code: string | null): string =>
  code === null ? "—" : (items?.find((item) => item.code === code)?.label ?? code);

/** `onOpen` phóng to ảnh qua lightbox — bấm ảnh KHÔNG được mở luôn trang chi tiết của cả dòng nên cần
 *  stopPropagation (dòng cũng có onClick mở trang chi tiết — xem bảng bên dưới). */
function captureImages(row: GatePass, onOpen: (url: string) => void): ReactElement {
  const entryUrl = row.capture.imageUrl;
  const exitUrl = row.exitCapture?.imageUrl ?? null;
  if (entryUrl === null && exitUrl === null) {
    return <span className="muted-text">—</span>;
  }
  const open = (event: MouseEvent, url: string): void => {
    event.stopPropagation();
    onOpen(url);
  };
  return (
    <div className="capture-thumb-row">
      {entryUrl !== null && <button className="capture-thumb" onClick={(event) => open(event, entryUrl)} title="Ảnh lúc vào" type="button"><img alt="Ảnh lúc vào" loading="lazy" src={entryUrl} /></button>}
      {exitUrl !== null && <button className="capture-thumb" onClick={(event) => open(event, exitUrl)} title="Ảnh lúc ra" type="button"><img alt="Ảnh lúc ra" loading="lazy" src={exitUrl} /></button>}
    </div>
  );
}

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

/** Sổ cân & truy vết: bảng đầy đủ mọi cột số liệu + ảnh bằng chứng của lượt xe, lấy thẳng từ API. Bấm vào
 *  một dòng để mở trang chi tiết riêng (PassPage.tsx, qua App.tsx) — sửa/xác nhận/từ chối làm ở đó, to rõ
 *  hơn hẳn popup cũ. Trạm cân trực tiếp (LivePage) chỉ xem, không sửa được ở đó nữa. */
export default function CapturesTable({ onOpenPass }: { onOpenPass: (id: string) => void }): ReactElement {
  const catalog = useGateCatalog();
  const { currentSiteId } = useAuth();
  const passesQuery = useQuery({
    queryKey: ["gate-passes-table", currentSiteId],
    queryFn: () => request<GatePass[]>(`/passes${siteQuery(currentSiteId)}`),
    refetchInterval: 3000
  });
  const queryClient = useQueryClient();
  const lightbox = useLightbox();
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const clear = useMutation({
    mutationFn: (scope: "resolved" | "all") =>
      request<ClearResult>(`/passes?scope=${scope}${currentSiteId !== null ? `&siteId=${encodeURIComponent(currentSiteId)}` : ""}`, { method: "DELETE" }),
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const importExcel = useMutation({
    mutationFn: async (file: File): Promise<ImportResult> => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE_URL}/gate/passes/import${siteQuery(currentSiteId)}`, { method: "POST", credentials: "include", body: form });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Nhập Excel thất bại.");
      }
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      const preview = result.errors.slice(0, 5).map((item) => `dòng ${item.row}: ${item.message}`).join("; ");
      const suffix = result.errors.length === 0 ? "" : ` — ${result.errors.length} dòng lỗi (${preview}${result.errors.length > 5 ? "…" : ""})`;
      setImportMessage(`Đã nhập ${result.imported} lượt từ Excel.${suffix}`);
      void queryClient.invalidateQueries({ queryKey: ["gate-passes-table"] });
    },
    onError: (error: unknown) => setImportMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.")
  });
  const onFileSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) {
      setImportMessage(null);
      importExcel.mutate(file);
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
    <section className="panel captures-page captures-full">
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
      <div className="captures-toolbar captures-extra">
        <a className="secondary-button captures-link-button" href={`${API_BASE_URL}/gate/import-template`} rel="noopener">Tải file mẫu Excel</a>
        <button
          className="secondary-button"
          disabled={importExcel.isPending || currentSiteId === null}
          title={currentSiteId === null ? "Chọn 1 cơ sở cụ thể trước (không nhập được ở \"Tất cả cơ sở\")." : "Nhập các lượt đã ghi tay lúc mất điện (cân xong cả hai đầu) từ file Excel."}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          {importExcel.isPending ? "Đang nhập…" : "Nhập Excel (backup mất điện)"}
        </button>
        <input accept=".xlsx" hidden ref={fileInputRef} type="file" onChange={onFileSelected} />
      </div>
      {importMessage !== null && <p className="muted-text">{importMessage}</p>}
      {rows.length === 0 ? (
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
                <th className="cell-center">Biển số</th>
                <th>Ra / Vào</th>
                <th>Tài xế</th>
                <th>Loại xe</th>
                <th>Loại đá</th>
                <th>Cân đầu vào</th>
                <th>Cân đầu ra</th>
                <th>Đá (net)</th>
                <th>Trạng thái</th>
                <th>Lý do</th>
                <th>Ảnh</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const legs = weighLegs(row.weighing);
                return (
                  <tr className="clickable" key={row.id} onClick={() => onOpenPass(row.id)}>
                    <td className="cell-num">{rows.length - index}</td>
                    <td className="cell-nowrap">{formatTime(row.capture.capturedAt)}</td>
                    <td className="cell-center"><span className="cell-plate">{row.effective.plateNumber}</span></td>
                    <td className="cell-nowrap"><span className={`status-pill visit-${row.visitStatus.toLowerCase()}`}>{VISIT_LABELS[row.visitStatus]}</span></td>
                    <td className="cell-nowrap">{driverText(row)}</td>
                    <td>{labelOf(catalog?.vehicleTypes, row.effective.vehicleType)}</td>
                    <td>{labelOf(catalog?.materials, row.effective.material)}</td>
                    <td className="cell-num">{legs.entry === null ? "—" : formatKg(legs.entry.kg)}</td>
                    <td className="cell-num">{legs.exit === null ? "—" : formatKg(legs.exit.kg)}</td>
                    <td className="cell-num">{formatKg(row.weighing?.netKg ?? null)}</td>
                    <td><span className={`status-pill gate-${row.status.toLowerCase()}`}>{STATUS_LABELS[row.status]}</span></td>
                    <td className="cell-reasons">{row.statusReasons.length === 0 ? "—" : row.statusReasons.map((reason) => <div key={reason}>{reason}</div>)}</td>
                    <td>{captureImages(row, lightbox.open)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Lightbox url={lightbox.openUrl} onClose={lightbox.close} />
    </section>
  );
}
