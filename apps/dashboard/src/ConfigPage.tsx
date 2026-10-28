import { FormEvent, ReactElement, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "./PassDetail";
import type { SiteCamera } from "./sites";
import { createSite, deleteSite, listCameras, listSites, updateCamera, updateSite } from "./sites";

const WEIGHBRIDGE_URL = `${API_BASE_URL}/gate/weighbridge/readings`;

/** Ô hiển thị 1 giá trị cấu hình cố định (URL) kèm nút sao chép — value dài tự xuống dòng, không tràn
 *  ra ngoài khung. */
function ConfigField({ label, value, hint, onCopied }: { label: string; value: string; hint: string; onCopied: () => void }): ReactElement {
  const copy = (): void => {
    void navigator.clipboard.writeText(value).then(onCopied);
  };
  return (
    <div className="config-field">
      <dt>{label}</dt>
      <div className="config-value-row">
        <code className="config-value">{value}</code>
        <button className="copy-button" type="button" onClick={copy}>Sao chép</button>
      </div>
      <small>{hint}</small>
    </div>
  );
}

/** Giống ConfigField nhưng sửa được — trạm cân/hãng cân thường có sẵn mã/API key riêng, cần nhập
 *  đúng giá trị của họ vào đây thay vì bắt họ theo giá trị hệ thống tự sinh. */
function EditableConfigField({
  label,
  value,
  hint,
  saving,
  onSave,
  onCopied
}: {
  label: string;
  value: string;
  hint: string;
  saving: boolean;
  onSave: (next: string) => void;
  onCopied: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== "" && draft.trim() !== value;
  const copy = (): void => {
    void navigator.clipboard.writeText(draft).then(onCopied);
  };
  return (
    <div className="config-field">
      <dt>{label}</dt>
      <div className="config-value-row">
        <input className="config-value-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="copy-button" type="button" onClick={copy}>Sao chép</button>
        <button className="primary-button config-save-button" disabled={!dirty || saving} type="button" onClick={() => onSave(draft.trim())}>
          Lưu
        </button>
      </div>
      <small>{hint}</small>
    </div>
  );
}

const EMPTY_SITE = { name: "" };

/**
 * Cấu hình cơ sở — chọn cơ sở ở select rồi cấu hình full màn bên dưới (không còn danh sách cơ sở dạng
 * bảng kèm panel cấu hình bên cạnh như trước). Mỗi cơ sở luôn có cố định 4 camera ("4 góc", tự tạo sẵn
 * lúc tạo cơ sở — xem SitesService.createDefaultCameras) nên không có nút thêm/xoá camera ở đây, chỉ sửa
 * label/rtspUrl từng góc. Master data (xe/tài xế) KHÔNG nằm ở đây — dùng chung mọi cơ sở của account, xem
 * tab "Danh mục xe & tài xế" ở Điều hành.
 */
export default function ConfigPage(): ReactElement {
  const { user, refreshSites } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<(typeof EMPTY_SITE & { id?: string }) | null>(null);
  const [cameraForm, setCameraForm] = useState<{ id: string; label: string; rtspUrl: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: listSites });
  const sites = sitesQuery.data ?? [];
  const camerasQuery = useQuery({ queryKey: ["site-cameras", selectedId], queryFn: () => listCameras(selectedId!), enabled: selectedId !== null });

  // Chưa chọn gì mà đã có cơ sở (ví dụ lần đầu vào trang) thì tự chọn cái đầu tiên, đỡ phải bấm thêm 1 lần.
  useEffect(() => {
    if (selectedId === null && sites.length > 0) {
      setSelectedId(sites[0].id);
    }
  }, [sites, selectedId]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["sites"] });
    void refreshSites();
  };
  const onError = (error: unknown): void => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.");

  const saveSite = useMutation({
    mutationFn: (form: NonNullable<typeof siteForm>) => (form.id === undefined ? createSite(form.name) : updateSite(form.id, { name: form.name })),
    onSuccess: (site) => {
      setSiteForm(null);
      setSelectedId(site.id);
      setMessage(null);
      refresh();
    },
    onError
  });
  const saveConnection = useMutation({
    mutationFn: (input: { scaleId?: string; weighbridgeApiKey?: string }) => updateSite(selectedId!, input),
    onSuccess: () => {
      setMessage("Đã lưu thông tin đấu nối.");
      refresh();
    },
    onError
  });
  const removeSite = useMutation({
    mutationFn: (id: string) => deleteSite(id),
    onSuccess: () => {
      setSelectedId(null);
      setMessage(null);
      refresh();
    },
    onError
  });
  const saveCamera = useMutation({
    mutationFn: (form: NonNullable<typeof cameraForm>) => updateCamera(form.id, { label: form.label, rtspUrl: form.rtspUrl }),
    onSuccess: () => {
      setCameraForm(null);
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["site-cameras", selectedId] });
    },
    onError
  });

  const selected = sites.find((site) => site.id === selectedId) ?? null;

  const submitSite = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (siteForm !== null) {
      saveSite.mutate(siteForm);
    }
  };
  const submitCamera = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (cameraForm !== null) {
      saveCamera.mutate(cameraForm);
    }
  };

  return (
    <section className="panel captures-page config-page">
      <div className="panel-heading">
        <div><p className="section-kicker">CẤU HÌNH</p><h2>Cơ sở &amp; camera</h2></div>
        <span className="count-badge">{sites.length} cơ sở</span>
      </div>

      <div className="master-toolbar">
        <label className="config-site-select">
          Cơ sở đang cấu hình
          <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value === "" ? null : event.target.value)}>
            {sites.length === 0 && <option value="">Chưa có cơ sở</option>}
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}{site.ownerName !== undefined ? ` — ${site.ownerName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="button" onClick={() => setSiteForm({ ...EMPTY_SITE })}>Thêm cơ sở</button>
      </div>
      {message !== null && <p className="muted-text">{message}</p>}

      {siteForm !== null && (
        <form className="master-form" onSubmit={submitSite}>
          <strong>{siteForm.id === undefined ? "Thêm cơ sở" : "Sửa tên cơ sở"}</strong>
          <label>Tên cơ sở<input required value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} /></label>
          <div className="gate-actions">
            <button className="primary-button" disabled={saveSite.isPending} type="submit">Lưu</button>
            <button className="secondary-button" type="button" onClick={() => setSiteForm(null)}>Huỷ</button>
          </div>
        </form>
      )}

      {selected === null ? (
        <p className="muted-text">{sites.length === 0 ? "Chưa có cơ sở nào — bấm Thêm cơ sở." : "Chọn một cơ sở ở trên để cấu hình."}</p>
      ) : (
        <>
          <div className="config-page-head">
            <h3>{selected.name}{isAdmin && selected.ownerName !== undefined ? ` — ${selected.ownerName}` : ""}</h3>
            <div className="row-actions">
              <button type="button" onClick={() => setSiteForm({ id: selected.id, name: selected.name })}>Sửa tên</button>
              <button className="danger" type="button" onClick={() => window.confirm(`Xoá cơ sở ${selected.name}?`) && removeSite.mutate(selected.id)}>
                Xoá cơ sở
              </button>
            </div>
          </div>

          <section className="config-section">
            <p className="section-kicker">ĐẤU NỐI CÂN ĐIỆN TỬ</p>
            <p className="muted-text">Cấu hình trạm cân/phần mềm cân (hoặc middleware trung gian) gửi số liệu tới đúng 3 mục dưới đây mỗi lần cân xong — hệ thống tự ghép vào đúng cơ sở này.</p>
            <ConfigField
              hint="Địa chỉ trạm cân sẽ POST số liệu tới (JSON)."
              label="Địa chỉ nhận dữ liệu"
              value={WEIGHBRIDGE_URL}
              onCopied={() => setMessage("Đã sao chép địa chỉ.")}
            />
            <EditableConfigField
              hint="Gửi trong body JSON, trường 'scaleId'. Nếu trạm cân/hãng cân của bạn đã có sẵn mã riêng, sửa lại đúng mã đó rồi bấm Lưu."
              label="Mã trạm cân (scaleId)"
              saving={saveConnection.isPending}
              value={selected.scaleId}
              onCopied={() => setMessage("Đã sao chép mã trạm cân.")}
              onSave={(next) => saveConnection.mutate({ scaleId: next })}
            />
            <EditableConfigField
              hint="Gửi kèm header X-Weighbridge-Key — thiếu hoặc sai sẽ bị từ chối. Sửa được nếu hãng cân yêu cầu dùng đúng key của họ."
              label="API key trạm cân"
              saving={saveConnection.isPending}
              value={selected.weighbridgeApiKey}
              onCopied={() => setMessage("Đã sao chép API key.")}
              onSave={(next) => saveConnection.mutate({ weighbridgeApiKey: next })}
            />
            <div className="config-example">
              <p className="muted-text">Ví dụ body JSON (mỗi lần cân chỉ gửi <strong>tareKg</strong> hoặc <strong>grossKg</strong>, không gửi cả hai):</p>
              <pre className="config-code">{`{\n  "scaleId": "${selected.scaleId}",\n  "tareKg": 9000\n}`}</pre>
            </div>
          </section>

          <section className="config-section">
            <p className="section-kicker">CAMERA (4 GÓC)</p>
            <p className="muted-text">
              Mỗi cơ sở có cố định 4 camera — điền link RTSP cho từng góc. Chạy nhận diện vẫn dùng dòng lệnh{" "}
              <code>python python/detect/pipeline.py &lt;rtspUrl&gt; &lt;cameraId&gt;</code>, chưa tự đọc cấu hình này.
            </p>
            {cameraForm !== null && (
              <form className="master-form" onSubmit={submitCamera}>
                <strong>Sửa camera</strong>
                <label>Tên gợi nhớ<input placeholder="Góc trước / Góc sau…" value={cameraForm.label} onChange={(event) => setCameraForm({ ...cameraForm, label: event.target.value })} /></label>
                <label>Link RTSP<input placeholder="rtsp://user:pass@ip:554/..." value={cameraForm.rtspUrl} onChange={(event) => setCameraForm({ ...cameraForm, rtspUrl: event.target.value })} /></label>
                <div className="gate-actions">
                  <button className="primary-button" disabled={saveCamera.isPending} type="submit">Lưu</button>
                  <button className="secondary-button" type="button" onClick={() => setCameraForm(null)}>Huỷ</button>
                </div>
              </form>
            )}
            <div className="sheet-wrap">
              <table className="sheet compact">
                <thead><tr><th>Tên gợi nhớ</th><th className="cell-center">Mã camera (cameraId)</th><th>Link RTSP</th><th /></tr></thead>
                <tbody>
                  {(camerasQuery.data ?? []).length === 0 && <tr><td className="cell-empty" colSpan={4}>Đang tải…</td></tr>}
                  {(camerasQuery.data ?? []).map((camera: SiteCamera) => (
                    <tr key={camera.id}>
                      <td>{camera.label || "—"}</td>
                      <td className="cell-center"><span className="cell-plate">{camera.cameraId}</span></td>
                      <td className="cell-wrap">{camera.rtspUrl || "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => setCameraForm({ id: camera.id, label: camera.label, rtspUrl: camera.rtspUrl })}>Sửa</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
