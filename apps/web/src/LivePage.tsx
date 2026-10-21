import { ChangeEvent, ReactElement, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL, API_ORIGIN, PassDetail, STATUS_LABELS, formatKg, formatTime, request, useGateCatalog } from "./PassDetail";
import type { GatePass } from "./PassDetail";
import VideoOverlay from "./VideoOverlay";

type GateEvent = { type: "upsert"; pass: GatePass } | { type: "remove"; id: string };

interface Job {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  inputUrl: string;
  errorMessage: string | null;
  originalName: string;
}

interface CaptureList {
  totalBytes: number;
}

interface ClearResult {
  removed: number;
  freedBytes: number;
}

const VISIBLE_ROWS = 100;
const JOB_LABELS: Record<Job["status"], string> = { PENDING: "Đang chờ", PROCESSING: "Đang nhận diện", COMPLETED: "Hoàn tất", FAILED: "Thất bại" };

async function uploadVideo(file: File): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/videos`, { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error((await response.text()) || "Upload video thất bại.");
  }
  return response.json() as Promise<Job>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const byTime = (first: GatePass, second: GatePass): number => second.capture.capturedAt.localeCompare(first.capture.capturedAt);

/** Realtime: chọn video, phát và nhận diện song song; biển số, xe, đá, cân hiện ngay khi worker xác nhận. */
export default function LivePage(): ReactElement {
  const queryClient = useQueryClient();
  const catalog = useGateCatalog();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<GatePass[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const jobQuery = useQuery({
    queryKey: ["live-job", jobId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/videos/${jobId!}`);
      if (!response.ok) {
        throw new Error("Không tải được trạng thái video.");
      }
      return (await response.json()) as Job;
    },
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" || query.state.data?.status === "FAILED" ? false : 1500)
  });
  const sizeQuery = useQuery({ queryKey: ["gate-captures"], queryFn: () => request<CaptureList>("/captures"), refetchInterval: 5000 });
  const upload = useMutation({
    mutationFn: uploadVideo,
    onSuccess: (job) => {
      setJobId(job.id);
      setFile(null);
      setSelectedId(null);
      setMessage(null);
    },
    onError: (error: unknown) => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.")
  });
  const clear = useMutation({
    mutationFn: (scope: "resolved" | "all") => request<ClearResult>(`/passes?scope=${scope}`, { method: "DELETE" }),
    onSuccess: (result) => {
      setMessage(`Đã xoá ${result.removed} lượt, giải phóng ${formatBytes(result.freedBytes)}.`);
      void queryClient.invalidateQueries({ queryKey: ["gate-captures"] });
    },
    onError: (error: unknown) => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.")
  });

  useEffect(() => {
    let cancelled = false;
    void request<GatePass[]>("/passes").then((passes) => {
      if (!cancelled) {
        // Gộp với sự kiện đã tới trong lúc tải để không mất dòng nào.
        setRows((current) => [...current, ...passes.filter((pass) => !current.some((row) => row.id === pass.id))].sort(byTime));
      }
    });
    const source = new EventSource(`${API_BASE_URL}/live/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as GateEvent;
      setRows((current) =>
        event.type === "remove"
          ? current.filter((row) => row.id !== event.id)
          : [event.pass, ...current.filter((row) => row.id !== event.pass.id)].sort(byTime)
      );
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  const job = jobQuery.data ?? null;
  const jobPasses = rows.filter((row) => row.capture.videoJobId === jobId);
  const selected = rows.find((row) => row.id === selectedId) ?? jobPasses[0] ?? rows[0] ?? null;
  const resolvedCount = rows.filter((row) => row.resolution !== "PENDING").length;
  const processing = job !== null && (job.status === "PENDING" || job.status === "PROCESSING");

  const selectRow = (row: GatePass): void => {
    setSelectedId(row.id);
    const video = videoRef.current;
    if (video !== null && row.capture.videoJobId === jobId && row.capture.mediaTimeSec !== null) {
      video.currentTime = row.capture.mediaTimeSec;
      video.pause();
    }
  };
  const confirmClear = (scope: "resolved" | "all", question: string): void => {
    if (window.confirm(question)) {
      clear.mutate(scope);
    }
  };

  return (
    <section className="content-grid">
      <aside className="sidebar panel">
        <div className="panel-heading">
          <div><p className="section-kicker">REALTIME</p><h2>Video đầu vào</h2></div>
          <span className={`status-pill ${connected ? "gate-verified" : "gate-mismatch"}`}>{connected ? "Đang nhận" : "Mất kết nối"}</span>
        </div>
        <label className="live-file">Chọn video để nhận diện
          <input accept="video/*" type="file" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button className="primary-button" disabled={file === null || upload.isPending} type="button" onClick={() => file !== null && upload.mutate(file)}>
          {upload.isPending ? "Đang upload…" : "Bắt đầu nhận diện"}
        </button>
        {job !== null && (
          <div className="live-job">
            <strong>{job.originalName}</strong>
            <small>{JOB_LABELS[job.status]}{processing ? ` · ${job.progress}%` : ""}</small>
            {processing && <div className="progress-track"><span style={{ width: `${job.progress}%` }} /></div>}
            {job.status === "FAILED" && <p className="error-message">{job.errorMessage ?? "Worker lỗi."}</p>}
          </div>
        )}
        {message !== null && <p className="muted-text">{message}</p>}

        <div className="sidebar-divider" />
        <div className="panel-heading compact-heading">
          <div><p className="section-kicker">LƯU TRỮ</p><h2>{rows.length} lượt · {formatBytes(sizeQuery.data?.totalBytes ?? 0)}</h2></div>
        </div>
        <div className="captures-toolbar">
          <button className="secondary-button" disabled={clear.isPending || resolvedCount === 0} type="button" onClick={() => confirmClear("resolved", `Xoá ${resolvedCount} lượt đã xác nhận/từ chối cùng ảnh của chúng? Không thể hoàn tác.`)}>
            Clear đã xử lý ({resolvedCount})
          </button>
          <button className="danger-button" disabled={clear.isPending || rows.length === 0} type="button" onClick={() => confirmClear("all", `Xoá TẤT CẢ ${rows.length} lượt, kể cả lượt chưa xử lý, cùng nhật ký và ảnh? Không thể hoàn tác.`)}>
            Clear tất cả
          </button>
        </div>

        <div className="job-list gate-list">
          {rows.length === 0 && <p className="muted-text">Chưa có lượt nào. Chọn video rồi bấm Bắt đầu nhận diện.</p>}
          {rows.slice(0, VISIBLE_ROWS).map((row) => (
            <button className={`job-item ${row.id === selected?.id ? "active" : ""}`} key={row.id} type="button" onClick={() => selectRow(row)}>
              <span className="job-copy"><strong>{row.effective.plateNumber}</strong><small>{formatTime(row.capture.capturedAt)} · {formatKg(row.weighing?.grossKg ?? null)}</small></span>
              <span className={`status-pill gate-${row.status.toLowerCase()}`}>{STATUS_LABELS[row.status]}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="main-column">
        {job !== null && (
          <div className="panel gate-block">
            <p className="section-kicker">VIDEO</p>
            <VideoOverlay passes={jobPasses} selectedId={selected?.id ?? null} src={`${API_ORIGIN}${job.inputUrl}`} videoRef={videoRef} />
            <p className="muted-text">Khung xanh là vùng biển số đang được nhận diện, đồng bộ theo thời gian phát.</p>
          </div>
        )}
        {selected === null ? (
          <div className="panel hero-panel"><div className="empty-state"><span className="empty-icon">◌</span><h3>Chưa có lượt xe</h3><p>Ảnh biển số, xe, đá và cân nặng sẽ hiện ở đây ngay khi nhận diện được.</p></div></div>
        ) : (
          <PassDetail catalog={catalog} pass={selected} />
        )}
      </section>
    </section>
  );
}
