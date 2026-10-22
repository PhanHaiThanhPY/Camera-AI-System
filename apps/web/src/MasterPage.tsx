import { FormEvent, ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL, useGateCatalog } from "./PassDetail";

interface Driver {
  id: string;
  vehicleId: string;
  fullName: string;
  phone: string;
  licenseNo: string;
  note: string;
  isPrimary: boolean;
}

interface Vehicle {
  id: string;
  plateNumber: string;
  vehicleType: string | null;
  note: string;
  drivers: Driver[];
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/master${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

const EMPTY_VEHICLE = { plateNumber: "", vehicleType: "", note: "" };
const EMPTY_DRIVER = { fullName: "", phone: "", licenseNo: "", note: "", isPrimary: false };

/** Master data: danh sách xe trong bãi và tài xế theo từng xe (thêm, sửa, xoá). */
export default function MasterPage(): ReactElement {
  const queryClient = useQueryClient();
  const catalog = useGateCatalog();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState<(typeof EMPTY_VEHICLE & { id?: string }) | null>(null);
  const [driverForm, setDriverForm] = useState<(typeof EMPTY_DRIVER & { id?: string }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const vehiclesQuery = useQuery({ queryKey: ["master-vehicles"], queryFn: () => api<Vehicle[]>("/vehicles") });
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["master-vehicles"] });
    void queryClient.invalidateQueries({ queryKey: ["gate-passes-table"] });
  };
  const onError = (error: unknown): void => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.");
  const saveVehicle = useMutation({
    mutationFn: (form: NonNullable<typeof vehicleForm>) => {
      const body = { plateNumber: form.plateNumber, vehicleType: form.vehicleType === "" ? null : form.vehicleType, note: form.note };
      return form.id === undefined ? api<Vehicle>("/vehicles", "POST", body) : api<Vehicle>(`/vehicles/${form.id}`, "PATCH", body);
    },
    onSuccess: (vehicle) => {
      setVehicleForm(null);
      setSelectedId(vehicle.id);
      setMessage(null);
      refresh();
    },
    onError
  });
  const removeVehicle = useMutation({
    mutationFn: (id: string) => api<{ removedDrivers: number }>(`/vehicles/${id}`, "DELETE"),
    onSuccess: (result) => {
      setSelectedId(null);
      setMessage(`Đã xoá xe và ${result.removedDrivers} tài xế.`);
      refresh();
    },
    onError
  });
  const importCaptured = useMutation({
    mutationFn: () => api<{ created: number; skipped: number }>("/vehicles/import-captured", "POST"),
    onSuccess: (result) => {
      setMessage(`Đã nhập ${result.created} xe mới, bỏ qua ${result.skipped} biển đã có.`);
      refresh();
    },
    onError
  });
  const saveDriver = useMutation({
    mutationFn: (form: NonNullable<typeof driverForm>) => {
      const { id, ...body } = form;
      return id === undefined ? api<Driver>(`/vehicles/${selectedId!}/drivers`, "POST", body) : api<Driver>(`/drivers/${id}`, "PATCH", body);
    },
    onSuccess: () => {
      setDriverForm(null);
      setMessage(null);
      refresh();
    },
    onError
  });
  const removeDriver = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/drivers/${id}`, "DELETE"),
    onSuccess: refresh,
    onError
  });

  const vehicles = (vehiclesQuery.data ?? []).filter((vehicle) => {
    const needle = search.trim().toLowerCase();
    return needle === "" || vehicle.plateNumber.toLowerCase().includes(needle) || vehicle.drivers.some((driver) => driver.fullName.toLowerCase().includes(needle));
  });
  const selected = vehiclesQuery.data?.find((vehicle) => vehicle.id === selectedId) ?? null;
  const typeLabel = (code: string | null): string => (code === null ? "—" : (catalog?.vehicleTypes.find((item) => item.code === code)?.label ?? code));

  const submitVehicle = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (vehicleForm !== null) {
      saveVehicle.mutate(vehicleForm);
    }
  };
  const submitDriver = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (driverForm !== null) {
      saveDriver.mutate(driverForm);
    }
  };
  const confirmRemoveVehicle = (vehicle: Vehicle): void => {
    if (window.confirm(`Xoá xe ${vehicle.plateNumber} và ${vehicle.drivers.length} tài xế của xe này?`)) {
      removeVehicle.mutate(vehicle.id);
    }
  };

  return (
    <div className="master-grid">
      <section className="panel captures-page">
        <div className="panel-heading">
          <div><p className="section-kicker">MASTER DATA</p><h2>Danh sách xe trong bãi</h2></div>
          <span className="count-badge">{vehiclesQuery.data?.length ?? 0} xe</span>
        </div>
        <div className="master-toolbar">
          <input aria-label="Tìm xe hoặc tài xế" placeholder="Tìm biển số hoặc tên tài xế…" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button className="primary-button" type="button" onClick={() => setVehicleForm({ ...EMPTY_VEHICLE })}>Thêm xe</button>
          <button className="secondary-button" disabled={importCaptured.isPending} type="button" onClick={() => importCaptured.mutate()}>Nhập từ ảnh đã chụp</button>
        </div>
        {message !== null && <p className="muted-text">{message}</p>}

        {vehicleForm !== null && (
          <form className="master-form" onSubmit={submitVehicle}>
            <strong>{vehicleForm.id === undefined ? "Thêm xe" : "Sửa xe"}</strong>
            <div className="master-form-grid">
              <label>Biển số<input required value={vehicleForm.plateNumber} onChange={(event) => setVehicleForm({ ...vehicleForm, plateNumber: event.target.value })} /></label>
              <label>Loại xe
                <select value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })}>
                  <option value="">Chưa xác định</option>
                  {catalog?.vehicleTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
            </div>
            <label>Ghi chú<input value={vehicleForm.note} onChange={(event) => setVehicleForm({ ...vehicleForm, note: event.target.value })} /></label>
            <div className="gate-actions">
              <button className="primary-button" disabled={saveVehicle.isPending} type="submit">Lưu</button>
              <button className="secondary-button" type="button" onClick={() => setVehicleForm(null)}>Huỷ</button>
            </div>
          </form>
        )}

        <div className="sheet-wrap">
          <table className="sheet compact">
            <thead><tr><th>Biển số</th><th>Loại xe</th><th>Tài xế</th><th>Ghi chú</th><th /></tr></thead>
            <tbody>
              {vehicles.length === 0 && <tr><td className="cell-empty" colSpan={5}>Chưa có xe. Bấm Thêm xe hoặc Nhập từ ảnh đã chụp.</td></tr>}
              {vehicles.map((vehicle) => (
                <tr className={`clickable ${vehicle.id === selectedId ? "row-selected" : ""}`} key={vehicle.id} onClick={() => setSelectedId(vehicle.id)}>
                  <td className="cell-plate">{vehicle.plateNumber}</td>
                  <td>{typeLabel(vehicle.vehicleType)}</td>
                  <td>{vehicle.drivers.length === 0 ? "—" : vehicle.drivers.map((driver) => driver.fullName).join(", ")}</td>
                  <td>{vehicle.note}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setVehicleForm({ id: vehicle.id, plateNumber: vehicle.plateNumber, vehicleType: vehicle.vehicleType ?? "", note: vehicle.note }); }}>Sửa</button>
                      <button className="danger" type="button" onClick={(event) => { event.stopPropagation(); confirmRemoveVehicle(vehicle); }}>Xoá</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel captures-page">
        <div className="panel-heading">
          <div><p className="section-kicker">TÀI XẾ</p><h2>{selected === null ? "Chọn một xe" : `Tài xế của ${selected.plateNumber}`}</h2></div>
        </div>
        {selected === null ? (
          <p className="muted-text">Chọn xe ở bảng bên trái để xem và quản lý tài xế.</p>
        ) : (
          <>
            <div className="master-toolbar">
              <button className="primary-button" type="button" onClick={() => setDriverForm({ ...EMPTY_DRIVER })}>Thêm tài xế</button>
            </div>
            {driverForm !== null && (
              <form className="master-form" onSubmit={submitDriver}>
                <strong>{driverForm.id === undefined ? "Thêm tài xế" : "Sửa tài xế"}</strong>
                <label>Họ tên<input required value={driverForm.fullName} onChange={(event) => setDriverForm({ ...driverForm, fullName: event.target.value })} /></label>
                <div className="master-form-grid">
                  <label>Số điện thoại<input value={driverForm.phone} onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })} /></label>
                  <label>Số bằng lái<input value={driverForm.licenseNo} onChange={(event) => setDriverForm({ ...driverForm, licenseNo: event.target.value })} /></label>
                </div>
                <label>Ghi chú<input value={driverForm.note} onChange={(event) => setDriverForm({ ...driverForm, note: event.target.value })} /></label>
                <label className="check"><input checked={driverForm.isPrimary} type="checkbox" onChange={(event) => setDriverForm({ ...driverForm, isPrimary: event.target.checked })} /> Tài xế chính</label>
                <div className="gate-actions">
                  <button className="primary-button" disabled={saveDriver.isPending} type="submit">Lưu</button>
                  <button className="secondary-button" type="button" onClick={() => setDriverForm(null)}>Huỷ</button>
                </div>
              </form>
            )}
            <div className="sheet-wrap">
              <table className="sheet compact">
                <thead><tr><th>Họ tên</th><th>SĐT</th><th>Bằng lái</th><th>Chính</th><th /></tr></thead>
                <tbody>
                  {selected.drivers.length === 0 && <tr><td className="cell-empty" colSpan={5}>Xe chưa có tài xế.</td></tr>}
                  {selected.drivers.map((driver) => (
                    <tr key={driver.id}>
                      <td>{driver.fullName}</td>
                      <td className="cell-nowrap">{driver.phone}</td>
                      <td className="cell-nowrap">{driver.licenseNo}</td>
                      <td>{driver.isPrimary ? "✓" : ""}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => setDriverForm({ id: driver.id, fullName: driver.fullName, phone: driver.phone, licenseNo: driver.licenseNo, note: driver.note, isPrimary: driver.isPrimary })}>Sửa</button>
                          <button className="danger" type="button" onClick={() => window.confirm(`Xoá tài xế ${driver.fullName}?`) && removeDriver.mutate(driver.id)}>Xoá</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
