import { FormEvent, ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "./PassDetail";

interface Driver {
  id: string;
  vehicleId: string | null;
  plateNumber: string | null;
  fullName: string;
  phone: string;
  licenseNo: string;
  note: string;
  isPrimary: boolean;
}

interface VehicleOption {
  id: string;
  plateNumber: string;
}

async function api<T>(base: string, path: string, method = "GET", body?: unknown, siteId?: string | null): Promise<T> {
  const qs = siteId !== null && siteId !== undefined ? `?siteId=${encodeURIComponent(siteId)}` : "";
  const response = await fetch(`${API_BASE_URL}${base}${path}${qs}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

const EMPTY_DRIVER = { fullName: "", phone: "", licenseNo: "", note: "", vehicleId: "", isPrimary: false };

/** Master data "Tài xế" — độc lập với xe, có thể gắn hoặc chưa gắn biển số nào. */
export default function DriversPage(): ReactElement {
  const queryClient = useQueryClient();
  const { currentSiteId } = useAuth();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<(typeof EMPTY_DRIVER & { id?: string }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const driversQuery = useQuery({ queryKey: ["drivers", currentSiteId], queryFn: () => api<Driver[]>("/drivers", "", "GET", undefined, currentSiteId) });
  const vehiclesQuery = useQuery({
    queryKey: ["master-vehicles", currentSiteId],
    queryFn: () => api<VehicleOption[]>("/master", "/vehicles", "GET", undefined, currentSiteId)
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["drivers"] });
    void queryClient.invalidateQueries({ queryKey: ["master-vehicles"] });
  };
  const onError = (error: unknown): void => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.");

  const saveDriver = useMutation({
    mutationFn: (value: NonNullable<typeof form>) => {
      const { id, vehicleId, ...rest } = value;
      const body = { ...rest, vehicleId: vehicleId === "" ? null : vehicleId };
      return id === undefined
        ? api<Driver>("/drivers", "", "POST", body, currentSiteId)
        : api<Driver>("/drivers", `/${id}`, "PATCH", body, currentSiteId);
    },
    onSuccess: () => {
      setForm(null);
      setMessage(null);
      refresh();
    },
    onError
  });
  const removeDriver = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>("/drivers", `/${id}`, "DELETE", undefined, currentSiteId),
    onSuccess: refresh,
    onError
  });

  const drivers = (driversQuery.data ?? []).filter((driver) => {
    const needle = search.trim().toLowerCase();
    return (
      needle === "" ||
      driver.fullName.toLowerCase().includes(needle) ||
      driver.phone.includes(needle) ||
      (driver.plateNumber?.toLowerCase().includes(needle) ?? false)
    );
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (form !== null) {
      saveDriver.mutate(form);
    }
  };

  const openEdit = (driver: Driver): void => {
    setForm({ id: driver.id, fullName: driver.fullName, phone: driver.phone, licenseNo: driver.licenseNo, note: driver.note, vehicleId: driver.vehicleId ?? "", isPrimary: driver.isPrimary });
  };

  return (
    <section className="panel captures-page">
      <div className="panel-heading">
        <div><p className="section-kicker">MASTER DATA</p><h2>Danh sách tài xế</h2></div>
        <span className="count-badge">{driversQuery.data?.length ?? 0} tài xế</span>
      </div>
      <div className="master-toolbar">
        <input aria-label="Tìm tài xế" placeholder="Tìm theo tên, SĐT hoặc biển số…" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="primary-button" type="button" onClick={() => setForm({ ...EMPTY_DRIVER })}>Thêm tài xế</button>
      </div>
      {message !== null && <p className="muted-text">{message}</p>}

      {form !== null && (
        <form className="master-form" onSubmit={submit}>
          <strong>{form.id === undefined ? "Thêm tài xế" : "Sửa tài xế"}</strong>
          <label>Họ tên<input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
          <div className="master-form-grid">
            <label>Số điện thoại<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Số bằng lái<input value={form.licenseNo} onChange={(event) => setForm({ ...form, licenseNo: event.target.value })} /></label>
            <label>Xe đang gắn
              <select value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}>
                <option value="">Chưa gắn xe</option>
                {vehiclesQuery.data?.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber}</option>)}
              </select>
            </label>
          </div>
          <label>Ghi chú<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          {form.vehicleId !== "" && (
            <label className="check"><input checked={form.isPrimary} type="checkbox" onChange={(event) => setForm({ ...form, isPrimary: event.target.checked })} /> Tài xế chính của xe này</label>
          )}
          <div className="gate-actions">
            <button className="primary-button" disabled={saveDriver.isPending} type="submit">Lưu</button>
            <button className="secondary-button" type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}

      <div className="sheet-wrap">
        <table className="sheet compact">
          <thead><tr><th>Họ tên</th><th>SĐT</th><th>Bằng lái</th><th className="cell-center">Xe</th><th>Chính</th><th /></tr></thead>
          <tbody>
            {drivers.length === 0 && <tr><td className="cell-empty" colSpan={6}>Chưa có tài xế. Bấm Thêm tài xế.</td></tr>}
            {drivers.map((driver) => (
              <tr key={driver.id}>
                <td>{driver.fullName}</td>
                <td className="cell-nowrap">{driver.phone}</td>
                <td className="cell-nowrap">{driver.licenseNo}</td>
                <td className="cell-center">{driver.plateNumber === null ? "—" : <span className="cell-plate">{driver.plateNumber}</span>}</td>
                <td>{driver.isPrimary ? "✓" : ""}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" onClick={() => openEdit(driver)}>Sửa</button>
                    <button className="danger" type="button" onClick={() => window.confirm(`Xoá tài xế ${driver.fullName}?`) && removeDriver.mutate(driver.id)}>Xoá</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
