export const VIDEO_STATUS = {
  pending: "PENDING",
  processing: "PROCESSING",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED"
} as const;

export type VideoStatus = (typeof VIDEO_STATUS)[keyof typeof VIDEO_STATUS];

export interface DetectionClassification {
  code: string | null;
  confidence: number | null;
  source: "model" | "zero-shot" | "operator" | "unavailable";
}

export interface DetectionPlateRegion {
  points: [number, number][];
  frameWidth: number | null;
  frameHeight: number | null;
  source: "model-contour" | "model-bbox";
}

export interface DetectionBox {
  /** x1, y1, x2, y2 chuẩn hoá 0..1 theo frame gốc. */
  box: [number, number, number, number];
  source: "model" | "heuristic";
}

export interface DetectionResult {
  plateNumber: string;
  confidence: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  evidenceSeconds: number;
  snapshotUrl: string | null;
  evidenceSnapshotUrl: string | null;
  evidenceMode: "model";
  trackId?: string;
  final?: boolean;
  /** [giây, x1, y1, x2, y2] chuẩn hoá: vị trí biển số theo thời gian, dùng vẽ khung trên video. */
  trail?: [number, number, number, number, number][];
  detectorConfidence?: number | null;
  ocrConfidence?: number | null;
  plateRegion?: DetectionPlateRegion | null;
  vehicleImageUrl?: string | null;
  loadImageUrl?: string | null;
  vehicleBox?: DetectionBox | null;
  loadBox?: DetectionBox | null;
  vehicleType?: DetectionClassification;
  material?: DetectionClassification;
}

export interface VideoJob {
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

export interface WorkerResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  annotatedVideoPath: string | null;
  detections: DetectionResult[];
}

