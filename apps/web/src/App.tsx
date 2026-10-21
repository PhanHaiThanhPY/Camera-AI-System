import { ChangeEvent, FormEvent, ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type VideoStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

interface DetectionResult {
  plateNumber: string;
  confidence: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  evidenceSeconds: number;
  snapshotUrl: string | null;
  evidenceSnapshotUrl: string | null;
  evidenceMode: "demo" | "model";
}

interface VideoJob {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: VideoStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  inputUrl: string;
  annotatedVideoUrl: string | null;
  metadata: {
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
  };
  detections: DetectionResult[];
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const STATUS_LABELS: Record<VideoStatus, string> = {
  PENDING: "Đang chờ",
  PROCESSING: "Đang xử lý",
  COMPLETED: "Hoàn tất",
  FAILED: "Thất bại"
};
const ACCEPTED_VIDEO_TYPES = "video/mp4,video/webm,video/quicktime,video/x-msvideo";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Có lỗi xảy ra, vui lòng thử lại.";
}

async function fetchVideos(): Promise<VideoJob[]> {
  const response = await fetch(`${API_BASE_URL}/videos`);
  if (!response.ok) {
    throw new Error("Không thể tải danh sách video.");
  }

  return response.json() as Promise<VideoJob[]>;
}

async function fetchVideo(id: string): Promise<VideoJob> {
  const response = await fetch(`${API_BASE_URL}/videos/${id}`);
  if (!response.ok) {
    throw new Error("Không thể tải trạng thái video.");
  }

  return response.json() as Promise<VideoJob>;
}

async function uploadVideo(file: File): Promise<VideoJob> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/videos`, { method: "POST", body: formData });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Upload video thất bại.");
  }

  return response.json() as Promise<VideoJob>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatVideoTime(seconds: number): string {
  const parsedSeconds = Number(seconds);
  const safeSeconds = Number.isFinite(parsedSeconds) ? Math.max(0, Math.floor(parsedSeconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function App(): ReactElement {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedDetectionKey, setSelectedDetectionKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const videosQuery = useQuery({ queryKey: ["videos"], queryFn: fetchVideos, refetchInterval: 3000 });
  const selectedVideoQuery = useQuery({
    queryKey: ["video", selectedJobId],
    queryFn: () => fetchVideo(selectedJobId!),
    enabled: selectedJobId !== null,
    refetchInterval: 2000
  });
  const uploadMutation = useMutation({
    mutationFn: uploadVideo,
    onSuccess: (job) => {
      setSelectedJobId(job.id);
      setSelectedFile(null);
      setErrorMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error: unknown) => setErrorMessage(getErrorMessage(error))
  });

  const selectedJob = selectedVideoQuery.data ?? videosQuery.data?.find((job) => job.id === selectedJobId) ?? null;
  const isUploading = uploadMutation.isPending;
  const isProcessing = selectedJob?.status === "PROCESSING" || selectedJob?.status === "PENDING";
  const selectedVideoUrl = selectedJob?.annotatedVideoUrl ? `${API_ORIGIN}${selectedJob.annotatedVideoUrl}` : null;
  const detectionCountLabel = useMemo(() => `${selectedJob?.detections.length ?? 0} kết quả`, [selectedJob?.detections.length]);

  const handleSeekToDetection = (detection: DetectionResult): void => {
    setSelectedDetectionKey(detection.plateNumber);
    const video = videoRef.current;
    if (video === null) {
      return;
    }

    const evidenceSeconds = Number(detection.evidenceSeconds);
    video.currentTime = Number.isFinite(evidenceSeconds) ? Math.max(0, evidenceSeconds) : 0;
    video.pause();
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useEffect(() => {
    if (selectedJobId === null && videosQuery.data?.[0] !== undefined) {
      setSelectedJobId(videosQuery.data[0].id);
    }
  }, [selectedJobId, videosQuery.data]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSelectedFile(event.target.files?.[0] ?? null);
    setErrorMessage(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (selectedFile === null) {
      setErrorMessage("Vui lòng chọn video trước khi upload.");
      return;
    }

    uploadMutation.mutate(selectedFile);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAMERA AI / MVP</p>
          <h1>Nhận diện xe từ video</h1>
          <p className="subtitle">Upload video để kiểm tra luồng xử lý và kết quả nhận diện biển số.</p>
        </div>
        <div className="system-chip"><span className="status-dot" /> Local LPR model</div>
      </header>

      <section className="content-grid">
        <aside className="sidebar panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">INPUT</p>
              <h2>Video mới</h2>
            </div>
            <span className="step-badge">01</span>
          </div>
          <form className="upload-form" onSubmit={handleSubmit}>
            <label className="dropzone" htmlFor="video-input">
              <span className="upload-icon">↑</span>
              <strong>{selectedFile?.name ?? "Chọn video để upload"}</strong>
              <small>{selectedFile === null ? "MP4, WebM, MOV hoặc AVI · tối đa 500 MB" : formatBytes(selectedFile.size)}</small>
              <input id="video-input" type="file" accept={ACCEPTED_VIDEO_TYPES} onChange={handleFileChange} />
            </label>
            <button className="primary-button" type="submit" disabled={isUploading || selectedFile === null}>
              {isUploading ? "Đang upload…" : "Bắt đầu nhận diện"}
            </button>
          </form>
          {errorMessage !== null && <p className="error-message">{errorMessage}</p>}

          <div className="sidebar-divider" />
          <div className="panel-heading compact-heading">
            <div>
              <p className="section-kicker">HISTORY</p>
              <h2>Video đã xử lý</h2>
            </div>
            <span className="count-badge">{videosQuery.data?.length ?? 0}</span>
          </div>
          <div className="job-list">
            {videosQuery.isLoading && <p className="muted-text">Đang tải…</p>}
            {videosQuery.data?.length === 0 && <p className="muted-text">Chưa có video nào.</p>}
            {videosQuery.data?.map((job) => (
              <button className={`job-item ${job.id === selectedJobId ? "active" : ""}`} key={job.id} type="button" onClick={() => setSelectedJobId(job.id)}>
                <span className="job-icon">▶</span>
                <span className="job-copy"><strong>{job.originalName}</strong><small>{formatDate(job.createdAt)}</small></span>
                <span className={`status-pill status-${job.status.toLowerCase()}`}>{STATUS_LABELS[job.status]}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <div className="panel hero-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">PROCESSING OUTPUT</p>
                <h2>{selectedJob?.originalName ?? "Chưa chọn video"}</h2>
              </div>
              {selectedJob !== null && <div className="heading-actions"><span className={`status-pill status-${selectedJob.status.toLowerCase()}`}>{STATUS_LABELS[selectedJob.status]}</span>{selectedJob.status === "COMPLETED" && <span className="result-count">{selectedJob.detections.length} biển số</span>}</div>}
            </div>
            {selectedJob === null && <div className="empty-state"><span className="empty-icon">◌</span><h3>Chưa có video để hiển thị</h3><p>Upload video đầu tiên ở cột bên trái để bắt đầu.</p></div>}
            {selectedJob !== null && isProcessing && <div className="processing-state"><div className="spinner" /><h3>AI đang phân tích video</h3><p>Worker đang đọc frame và chuẩn bị kết quả nhận diện.</p><div className="progress-track"><span style={{ width: `${selectedJob.progress}%` }} /></div><strong>{selectedJob.progress}%</strong></div>}
            {selectedJob !== null && selectedJob.status === "FAILED" && <div className="empty-state failed-state"><span className="empty-icon">!</span><h3>Không thể xử lý video</h3><p>{selectedJob.errorMessage ?? "Worker trả về lỗi không xác định."}</p></div>}
            {selectedJob !== null && selectedJob.status === "COMPLETED" && <>
              <div className="video-frame">
                {selectedVideoUrl !== null ? <video ref={videoRef} controls src={selectedVideoUrl} /> : <div className="video-placeholder"><span>▶</span><p>Chưa tạo được video kết quả</p></div>}
              </div>
              {selectedJob.detections.length > 0 && <div className="event-strip">
                <div className="event-strip-heading"><span><strong>Mốc phát hiện</strong><small>Bấm vào mốc để xem đúng khung hình AI dùng làm bằng chứng</small></span><span className="event-strip-count">{selectedJob.detections.length} sự kiện</span></div>
                <div className="event-timeline">
                  <span className="timeline-line" />
                  {selectedJob.detections.map((detection) => {
                    const duration = selectedJob.metadata.durationSeconds ?? 0;
                    const evidenceSeconds = Number(detection.evidenceSeconds);
                    const position = duration > 0 && Number.isFinite(evidenceSeconds) ? Math.min((evidenceSeconds / duration) * 100, 100) : 0;
                    return <button className={`timeline-marker ${selectedDetectionKey === detection.plateNumber ? "active" : ""}`} key={`marker-${detection.plateNumber}`} style={{ left: `${position}%` }} type="button" onClick={() => handleSeekToDetection(detection)} title={`Xem ${detection.plateNumber} tại ${formatVideoTime(detection.evidenceSeconds)}`}><span />{formatVideoTime(detection.evidenceSeconds)}</button>;
                  })}
                </div>
              </div>}
            </>}
          </div>

          {selectedJob !== null && selectedJob.status === "COMPLETED" && <section className="results-section">
            <div className="results-header"><div><p className="section-kicker">DETECTIONS</p><h2>Kết quả nhận diện</h2></div><span className="count-badge">{detectionCountLabel}</span></div>
            <div className="results-grid">
              {selectedJob.detections.map((detection) => <article className={`detection-card ${selectedDetectionKey === detection.plateNumber ? "selected" : ""}`} key={`${selectedJob.id}-${detection.plateNumber}`}>
                <div className="evidence-images">
                  <div className="overview-snapshot">{detection.evidenceSnapshotUrl !== null && detection.evidenceSnapshotUrl !== undefined ? <img alt={`Toàn cảnh phát hiện biển số ${detection.plateNumber}`} src={`${API_ORIGIN}${detection.evidenceSnapshotUrl}`} /> : <span>Toàn cảnh chưa có</span>}<small>TOÀN CẢNH + KHUNG</small></div>
                  <div className="snapshot">{detection.snapshotUrl !== null ? <img alt={`Ảnh crop biển số ${detection.plateNumber}`} src={`${API_ORIGIN}${detection.snapshotUrl}`} /> : <span>Ảnh crop chưa có</span>}<small>CROP BIỂN SỐ</small></div>
                </div>
                <div className="detection-info"><div className="plate-row"><strong>{detection.plateNumber}</strong><span>{Math.round(detection.confidence * 100)}%</span></div><div className="confidence-track"><span style={{ width: `${detection.confidence * 100}%` }} /></div><dl><div><dt>Khung bằng chứng</dt><dd>{formatVideoTime(detection.evidenceSeconds)}</dd></div><div><dt>Thời gian</dt><dd>{detection.firstDetectedAt} — {detection.lastDetectedAt}</dd></div><div><dt>Nguồn</dt><dd>{detection.evidenceMode === "demo" ? "Demo mode" : "AI model"}</dd></div></dl><button className="secondary-button" type="button" onClick={() => handleSeekToDetection(detection)}>Xem vị trí phát hiện <span>→</span></button></div>
              </article>)}
              {selectedJob.detections.length === 0 && <div className="no-detection"><span>⌁</span><p>Chưa phát hiện biển số. Hãy kiểm tra video hoặc cấu hình model LPR.</p></div>}
            </div>
          </section>}

          <div className="architecture-note"><span className="note-icon">i</span><p><strong>Pipeline LPR đã sẵn sàng.</strong> Worker hỗ trợ demo mode hoặc model thật. Cấu hình <code>AI_DEMO_MODE=false</code> cùng <code>LPR_MODEL_PATH</code> để đọc biển số bằng model.</p></div>
        </section>
      </section>
    </main>
  );
}

export default App;

