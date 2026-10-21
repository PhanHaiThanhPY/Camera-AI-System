import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { VIDEO_STATUS } from "./video.types";
import type { VideoJob, WorkerResult } from "./video.types";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");
const resultRoot = join(storageRoot, "results");
const workerPath = join(__dirname, "../../../../services/ai-worker/worker.py");

function isWorkerResult(value: unknown): value is WorkerResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.detections);
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);
  private readonly jobs = new Map<string, VideoJob>();

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
      this.logger.log(`video-job queued id=${id} file=${file.originalname} size=${file.size}`);
      void this.processJob(id, file.path);
      return job;
    } catch (error: unknown) {
      this.logger.error("Failed to create video job", error instanceof Error ? error.stack : undefined);
      throw error;
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

  private async processJob(id: string, inputPath: string): Promise<void> {
    const job = this.getJob(id);
    const startedAt = Date.now();
    job.status = VIDEO_STATUS.processing;
    job.progress = 10;
    job.updatedAt = new Date().toISOString();
    this.logger.log(`video-job processing id=${id}`);

    try {
      const workerResult = await this.runWorker(id, inputPath);
      job.status = VIDEO_STATUS.completed;
      job.progress = 100;
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
      const worker = spawn(process.env.PYTHON_BIN ?? "python3", [workerPath, inputPath, resultRoot, id], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      worker.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      worker.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
        const progressMatches = chunk.toString("utf8").matchAll(/WORKER_PROGRESS=(\d+)/g);
        for (const match of progressMatches) {
          const workerProgress = Number(match[1]);
          const job = this.getJob(id);
          job.progress = Math.min(95, 10 + Math.round(workerProgress * 0.85));
          job.updatedAt = new Date().toISOString();
        }
      });
      worker.on("error", reject);
      worker.on("close", (code) => {
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

