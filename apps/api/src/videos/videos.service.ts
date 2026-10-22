import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { VIDEO_STATUS } from "./video.types";
import type { DetectionResult, VideoJob, WorkerResult } from "./video.types";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");
const resultRoot = join(storageRoot, "results");
const workerPath = join(__dirname, "../../../../services/ai-worker/worker.py");
const repositoryRoot = join(__dirname, "../../../../");
const pythonCandidates = [
  join(repositoryRoot, ".venv/bin/python"),
  join(repositoryRoot, "services/ai-worker/.venv312/bin/python"),
  join(repositoryRoot, "services/ai-worker/.venv/bin/python")
];
const configuredPython = process.env.PYTHON_BIN?.trim();
const pythonBin = configuredPython || pythonCandidates.find((candidate) => existsSync(candidate)) || "python3";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isWorkerResult(value: unknown): value is WorkerResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.detections);
}

@Injectable()
export class VideosService implements OnModuleDestroy {
  private readonly logger = new Logger(VideosService.name);
  private readonly jobs = new Map<string, VideoJob>();
  private readonly workers = new Map<string, ChildProcess>();
  private readonly pendingJobIds: string[] = [];
  private readonly maxConcurrentJobs = positiveInteger(process.env.MAX_CONCURRENT_VIDEO_JOBS, 1);
  private readonly cancelling = new Set<string>();
  private readonly detectionListeners: ((job: VideoJob, detection: DetectionResult) => void)[] = [];

  public constructor() {
    mkdirSync(resultRoot, { recursive: true });
  }

  public async createJob(file: Express.Multer.File): Promise<VideoJob> {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const job: VideoJob = {
        id,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        status: VIDEO_STATUS.pending,
        progress: 0,
        createdAt: now,
        updatedAt: now,
        errorMessage: null,
        inputUrl: `/storage/uploads/${basename(file.filename)}`,
        annotatedVideoUrl: null,
        metadata: { durationSeconds: null, width: null, height: null },
        detections: []
      };

      this.jobs.set(id, job);
      this.pendingJobIds.push(id);
      this.logger.log(`video-job queued id=${id} file=${file.originalname} size=${file.size}`);
      this.startPendingJobs();
      return job;
    } catch (error: unknown) {
      this.logger.error("Failed to create video job", error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /** Nhận từng biển số ngay khi worker xác nhận (realtime), không chờ video xử lý xong. */
  public onDetection(listener: (job: VideoJob, detection: DetectionResult) => void): void {
    this.detectionListeners.push(listener);
  }

  private handleWorkerEvent(job: VideoJob, detection: DetectionResult): void {
    const index = job.detections.findIndex((item) => item.trackId !== undefined && item.trackId === detection.trackId);
    if (index >= 0) {
      job.detections[index] = detection;
    } else {
      job.detections.push(detection);
    }
    job.updatedAt = new Date().toISOString();
    for (const listener of this.detectionListeners) {
      try {
        listener(job, detection);
      } catch (error: unknown) {
        this.logger.error(`video-job listener failed id=${job.id}`, error instanceof Error ? error.stack : undefined);
      }
    }
  }

  /** Chạy một lệnh phụ của worker (ví dụ classify-material) và trả stdout. */
  public runWorkerCli(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = spawn(pythonBin, [workerPath, ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      worker.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      worker.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      worker.on("error", reject);
      worker.on("close", (code) =>
        code === 0 ? resolve(Buffer.concat(stdout).toString("utf8")) : reject(new Error(Buffer.concat(stderr).toString("utf8") || `Worker exited with code ${code ?? "unknown"}.`))
      );
    });
  }

  /**
   * Nút Dừng: báo worker dừng êm (chốt các xe đang theo dõi rồi thoát) để giữ kết quả đã nhận diện;
   * quá 10 giây chưa thoát thì buộc dừng.
   */
  public cancelJob(id: string): VideoJob {
    const job = this.getJob(id);
    const worker = this.workers.get(id);
    if (worker === undefined) {
      const pendingIndex = this.pendingJobIds.indexOf(id);
      if (pendingIndex >= 0 && job.status === VIDEO_STATUS.pending) {
        this.pendingJobIds.splice(pendingIndex, 1);
        job.status = VIDEO_STATUS.cancelled;
        job.updatedAt = new Date().toISOString();
        return job;
      }
      throw new ConflictException("Video không còn đang xử lý.");
    }
    this.cancelling.add(id);
    worker.kill("SIGTERM");
    setTimeout(() => {
      if (this.workers.get(id) === worker) {
        worker.kill("SIGKILL");
      }
    }, 10_000).unref();
    this.logger.log(`video-job cancel requested id=${id}`);
    return job;
  }

  public onModuleDestroy(): void {
    for (const worker of this.workers.values()) {
      worker.kill("SIGKILL");
    }
  }

  public listJobs(): VideoJob[] {
    return [...this.jobs.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  public getJob(id: string): VideoJob {
    const job = this.jobs.get(id);
    if (job === undefined) {
      throw new NotFoundException("Không tìm thấy video job.");
    }

    return job;
  }

  private startPendingJobs(): void {
    while (this.workers.size < this.maxConcurrentJobs && this.pendingJobIds.length > 0) {
      const id = this.pendingJobIds.shift();
      if (id === undefined) {
        return;
      }
      const job = this.jobs.get(id);
      if (job === undefined || job.status !== VIDEO_STATUS.pending) {
        continue;
      }
      const inputPath = join(storageRoot, "uploads", basename(job.inputUrl));
      void this.processJob(id, inputPath);
    }
  }

  private async processJob(id: string, inputPath: string): Promise<void> {
    const job = this.getJob(id);
    const startedAt = Date.now();
    job.status = VIDEO_STATUS.processing;
    job.progress = 10;
    job.updatedAt = new Date().toISOString();
    this.logger.log(`video-job processing id=${id}`);

    try {
      const workerResult = await this.runWorker(id, inputPath);
      job.status = this.cancelling.delete(id) ? VIDEO_STATUS.cancelled : VIDEO_STATUS.completed;
      job.progress = job.status === VIDEO_STATUS.cancelled ? job.progress : 100;
      job.updatedAt = new Date().toISOString();
      job.metadata = {
        durationSeconds: workerResult.durationSeconds,
        width: workerResult.width,
        height: workerResult.height
      };
      job.detections = workerResult.detections;

      if (workerResult.annotatedVideoPath !== null && existsSync(workerResult.annotatedVideoPath)) {
        const relativePath = relative(storageRoot, workerResult.annotatedVideoPath).split("\\").join("/");
        job.annotatedVideoUrl = `/storage/${relativePath}`;
      }
      this.logger.log(
        `video-job completed id=${id} detections=${job.detections.length} durationMs=${Date.now() - startedAt}`
      );
    } catch (error: unknown) {
      if (this.cancelling.delete(id)) {
        // Bị buộc dừng trước khi worker kịp trả kết quả: giữ các xe đã nhận diện.
        job.status = VIDEO_STATUS.cancelled;
        job.updatedAt = new Date().toISOString();
        this.logger.log(`video-job cancelled (forced) id=${id} detections=${job.detections.length}`);
        return;
      }
      const message = error instanceof Error ? error.message : "Worker xử lý video thất bại.";
      job.status = VIDEO_STATUS.failed;
      job.progress = 100;
      job.errorMessage = message;
      job.updatedAt = new Date().toISOString();
      this.logger.error(`video-job failed id=${id} durationMs=${Date.now() - startedAt}: ${message}`);
    }
  }

  private runWorker(id: string, inputPath: string): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const worker = spawn(pythonBin, [workerPath, inputPath, resultRoot, id], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      this.workers.set(id, worker);

      worker.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      let pending = "";
      worker.stderr.on("data", (chunk: Buffer) => {
        const lines = (pending + chunk.toString("utf8")).split("\n");
        pending = lines.pop() ?? "";
        const job = this.getJob(id);
        for (const line of lines) {
          const progress = /^WORKER_PROGRESS=(\d+)/.exec(line);
          if (progress !== null) {
            job.progress = Math.min(95, 10 + Math.round(Number(progress[1]) * 0.85));
            job.updatedAt = new Date().toISOString();
          } else if (line.startsWith("WORKER_EVENT=")) {
            try {
              this.handleWorkerEvent(job, JSON.parse(line.slice("WORKER_EVENT=".length)) as DetectionResult);
            } catch (error: unknown) {
              this.logger.warn(`bad worker event id=${id}: ${error instanceof Error ? error.message : "unknown"}`);
            }
          } else if (line.trim() !== "") {
            stderr.push(Buffer.from(`${line}\n`));
          }
        }
      });
      worker.on("error", reject);
      worker.on("close", (code) => {
        this.workers.delete(id);
        this.startPendingJobs();
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8") || `Worker exited with code ${code ?? "unknown"}.`));
          return;
        }

        try {
          const parsed: unknown = JSON.parse(Buffer.concat(stdout).toString("utf8"));
          if (!isWorkerResult(parsed)) {
            reject(new Error("Worker trả về dữ liệu không hợp lệ."));
            return;
          }

          resolve(parsed);
        } catch (error: unknown) {
          reject(error);
        }
      });
    });
  }
}

