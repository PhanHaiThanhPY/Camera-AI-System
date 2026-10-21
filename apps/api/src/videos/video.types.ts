export const VIDEO_STATUS = {
  pending: "PENDING",
  processing: "PROCESSING",
  completed: "COMPLETED",
  failed: "FAILED"
} as const;

export type VideoStatus = (typeof VIDEO_STATUS)[keyof typeof VIDEO_STATUS];

export interface DetectionResult {
  plateNumber: string;
  confidence: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  evidenceSeconds: number;
  snapshotUrl: string | null;
  evidenceSnapshotUrl: string | null;
  evidenceMode: "demo" | "model";
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

