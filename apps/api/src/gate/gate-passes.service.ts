import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Subject } from "rxjs";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { DetectionResult, VideoJob } from "../videos/video.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VideosService } from "../videos/videos.service";
import { findVehicleProfile, isKnownMaterial } from "./gate.catalog";
import { randomWeights } from "./gate.mock";
import type { AuditEntry, Classification, GateOverrides, GatePass, WeighReading, WeighSummary } from "./gate.types";
import {
  deriveStatus,
  matchScore,
  secondWeighScore,
  normalizePlate,
  readVerificationConfig,
  runChecks
} from "./gate.verification";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");

export interface ReadingInput {
  scaleId: string;
  ticketNo: string | null;
  plateNumber: string | null;
  grossKg: number | null;
  tareKg: number | null;
  measuredAt: string;
}

export interface ResolveInput {
  actor: string;
  reason: string | null;
  overrides: GateOverrides;
}

export interface CaptureRecord {
  id: string;
  plateNumber: string;
  capturedAt: string;
  source: "video";
  status: GatePass["status"];
  resolution: GatePass["resolution"];
  overviewUrl: string | null;
  plateCropUrl: string | null;
  vehicleImageUrl: string | null;
  loadImageUrl: string | null;
  sizeBytes: number;
}

export type ClearScope = "resolved" | "all";

/** Chỉ cho phép đụng tới file nằm trong thư mục storage. */
function storagePath(url: string | null): string | null {
  if (url === null || !url.startsWith("/storage/")) {
    return null;
  }
  const absolute = resolve(storageRoot, url.slice("/storage/".length).split("?")[0] ?? "");
  return absolute.startsWith(resolve(storageRoot) + sep) ? absolute : null;
}

function captureUrls(capture: GatePass["capture"]): (string | null)[] {
  return [capture.overviewUrl, capture.plateCropUrl, capture.vehicleImageUrl, capture.loadImageUrl];
}

function fileSize(url: string | null): number {
  const path = storagePath(url);
  return path !== null && existsSync(path) ? statSync(path).size : 0;
}

export type GateEvent = { type: "upsert"; pass: GatePass } | { type: "remove"; id: string };

const UNAVAILABLE: Classification = { code: null, confidence: null, source: "unavailable" };

@Injectable()
export class GatePassesService {
  private readonly logger = new Logger(GatePassesService.name);
  private readonly config = readVerificationConfig();
  private readonly passes = new Map<string, GatePass>();
  private readonly readings = new Map<string, WeighReading>();
  private readonly passByTrack = new Map<string, string>();
  /** Luồng sự kiện cho realtime (SSE). */
  public readonly events = new Subject<GateEvent>();

  public constructor(videosService: VideosService) {
    videosService.onDetection((job, detection) => this.upsertFromDetection(job, detection));
  }

  public listPasses(): GatePass[] {
    return [...this.passes.values()].sort((first, second) => second.capture.capturedAt.localeCompare(first.capture.capturedAt));
  }

  public getPass(id: string): GatePass {
    const pass = this.passes.get(id);
    if (pass === undefined) {
      throw new NotFoundException("Không tìm thấy lượt xe.");
    }
    return pass;
  }

  public listCaptures(): { items: CaptureRecord[]; totalBytes: number } {
    const items = this.listPasses().map((pass): CaptureRecord => {
      const { capture } = pass;
      const urls = new Set(captureUrls(capture));
      return {
        id: pass.id,
        plateNumber: pass.effective.plateNumber,
        capturedAt: capture.capturedAt,
        source: capture.source,
        status: pass.status,
        resolution: pass.resolution,
        overviewUrl: capture.overviewUrl,
        plateCropUrl: capture.plateCropUrl,
        vehicleImageUrl: capture.vehicleImageUrl,
        loadImageUrl: capture.loadImageUrl,
        sizeBytes: [...urls].reduce((total, url) => total + fileSize(url), 0)
      };
    });
    return { items, totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0) };
  }

  /** Xoá bản ghi và ảnh của lượt xe; không đụng tới video gốc. Trả về số lượt và số byte đã giải phóng. */
  public clear(scope: ClearScope | string): { removed: number; freedBytes: number } {
    const targets = [...this.passes.values()].filter((pass) => scope === "all" || pass.resolution !== "PENDING");
    let freedBytes = 0;
    for (const pass of targets) {
      freedBytes += this.deletePass(pass);
    }
    if (scope === "all") {
      this.readings.clear();
    }
    this.logger.log(`gate-clear scope=${scope} removed=${targets.length} freedBytes=${freedBytes}`);
    return { removed: targets.length, freedBytes };
  }

  public remove(id: string): { removed: number; freedBytes: number } {
    return { removed: 1, freedBytes: this.deletePass(this.getPass(id)) };
  }

  private deletePass(pass: GatePass): number {
    let freed = 0;
    for (const url of new Set(captureUrls(pass.capture))) {
      const path = storagePath(url);
      if (path !== null && existsSync(path)) {
        freed += statSync(path).size;
        unlinkSync(path);
      }
    }
    for (const readingId of pass.weighing?.readingIds ?? []) {
      this.readings.delete(readingId);
    }
    this.passes.delete(pass.id);
    for (const [trackKey, passId] of this.passByTrack) {
      if (passId === pass.id) {
        this.passByTrack.delete(trackKey);
      }
    }
    this.events.next({ type: "remove", id: pass.id });
    return freed;
  }

  public listReadings(): WeighReading[] {
    return [...this.readings.values()].sort((first, second) => second.receivedAt.localeCompare(first.receivedAt));
  }

  /**
   * Nhận biển số từ worker (realtime). Lần đầu một xe được xác nhận thì tạo lượt xe và cân giả lập;
   * các lần sau (khi worker chốt frame/biển số tốt nhất) chỉ cập nhật ảnh và kết quả.
   */
  public upsertFromDetection(job: VideoJob, detection: DetectionResult): GatePass {
    const trackKey = `${job.id}:${detection.trackId ?? detection.plateNumber}`;
    const existingId = this.passByTrack.get(trackKey);
    const existing = existingId === undefined ? undefined : this.passes.get(existingId);

    if (existing === undefined) {
      const capture = this.captureFromDetection(job, detection, new Date().toISOString());
      const pass = this.registerPass(capture, detection.vehicleType ?? UNAVAILABLE, detection.material ?? UNAVAILABLE);
      this.passByTrack.set(trackKey, pass.id);
      this.mockWeigh(pass);
      return pass;
    }
    if (existing.resolution !== "PENDING") {
      return existing;
    }

    const plateChanged = existing.capture.plateText !== detection.plateNumber;
    existing.capture = this.captureFromDetection(job, detection, existing.capture.capturedAt);
    existing.vehicleType = detection.vehicleType ?? UNAVAILABLE;
    existing.material = detection.material ?? UNAVAILABLE;
    // Cân giả lập luôn "đọc" đúng biển camera; khi biển được chốt lại thì cân theo biển mới.
    if (plateChanged && existing.weighing?.source === "mock") {
      existing.weighing.plateNumber = detection.plateNumber;
    }
    this.refresh(existing);
    if (detection.final === true) {
      this.pushAudit(existing, "system", "capture_final", null, null, { plate: existing.capture.plateText, evidenceSeconds: existing.capture.mediaTimeSec });
    }
    this.events.next({ type: "upsert", pass: existing });
    return existing;
  }

  /**
   * Cân giả lập: mỗi lần chụp được biển số thì random cân tại thời điểm đó (hard code, chưa có trạm cân thật).
   * Đi qua đúng đường ingestReading như số liệu thật nên có thể thay bằng POST từ trạm cân mà không đổi logic ghép.
   */
  private mockWeigh(pass: GatePass): void {
    if (process.env.WEIGHBRIDGE_MOCK_RANDOM === "false") {
      return;
    }
    const { tareKg, grossKg } = randomWeights();
    const base = { scaleId: "SCALE-MOCK", ticketNo: `M${Date.now().toString(36).toUpperCase()}`, plateNumber: pass.capture.plateText };
    this.ingestReading({ ...base, grossKg, tareKg: null, measuredAt: new Date(Date.parse(pass.capture.capturedAt) + 20_000).toISOString() }, "mock");
    this.ingestReading({ ...base, grossKg: null, tareKg, measuredAt: new Date().toISOString() }, "mock");
  }

  /** Điểm vào của hệ thống cân ngoài. Tự ghép với lượt xe chưa có số liệu cân gần nhất. */
  public ingestReading(input: ReadingInput, source: WeighReading["source"] = "external"): WeighReading {
    const reading: WeighReading = {
      id: randomUUID(),
      ...input,
      receivedAt: new Date().toISOString(),
      source,
      gatePassId: null
    };
    this.readings.set(reading.id, reading);

    // Lần cân thứ hai của lượt xe đã có một lần cân: ghép theo biển số.
    let best: { pass: GatePass; score: number } | null = null;
    for (const pass of this.passes.values()) {
      if (pass.resolution !== "PENDING") {
        continue;
      }
      const score =
        pass.weighing === null
          ? matchScore(pass, reading, this.config.matchWindowSeconds)
          : secondWeighScore(pass, reading, this.config.secondWeighWindowSeconds);
      if (score !== null && (best === null || score > best.score)) {
        best = { pass, score };
      }
    }

    if (best === null) {
      this.logger.warn(`weigh-reading unmatched id=${reading.id} ticket=${reading.ticketNo ?? "-"}`);
    } else {
      this.attachReading(best.pass, reading, "system", null);
    }
    return reading;
  }

  public linkReading(passId: string, readingId: string, actor: string, reason: string | null): GatePass {
    const pass = this.getPass(passId);
    const reading = this.readings.get(readingId);
    if (reading === undefined) {
      throw new NotFoundException("Không tìm thấy số liệu cân.");
    }
    if (pass.resolution !== "PENDING") {
      throw new ConflictException("Lượt xe đã được xử lý, không thể đổi số liệu cân.");
    }
    if (reading.gatePassId !== null) {
      throw new ConflictException("Số liệu cân này đã gắn với một lượt xe.");
    }
    if (reason === null) {
      throw new BadRequestException("Ghép thủ công cần ghi lý do.");
    }
    this.attachReading(pass, reading, actor, reason);
    return pass;
  }

  public resolve(id: string, decision: "CONFIRMED" | "REJECTED", input: ResolveInput): GatePass {
    const pass = this.getPass(id);
    if (pass.resolution !== "PENDING") {
      throw new ConflictException("Lượt xe đã được xử lý.");
    }

    const hasOverride = Object.values(input.overrides).some((value) => value !== undefined);
    const acceptsUnverified = decision === "CONFIRMED" && pass.status !== "VERIFIED";
    if ((decision === "REJECTED" || hasOverride || acceptsUnverified) && input.reason === null) {
      throw new BadRequestException("Từ chối, chỉnh sửa kết quả AI hoặc xác nhận lượt chưa đạt kiểm tra bắt buộc ghi lý do.");
    }
    if (decision === "CONFIRMED" && (pass.status === "WAITING_WEIGHT" || pass.status === "WAITING_SECOND_WEIGH")) {
      throw new ConflictException("Chưa đủ hai lần cân (gross và tare), không thể xác nhận.");
    }
    this.validateOverrides(input.overrides);

    const before = { ...pass.effective };
    pass.overrides = { ...pass.overrides, ...stripUndefined(input.overrides) };
    this.refresh(pass);
    pass.resolution = decision;
    this.pushAudit(pass, input.actor, decision === "CONFIRMED" ? "confirm" : "reject", input.reason, before, {
      ...pass.effective
    });
    this.events.next({ type: "upsert", pass });
    return pass;
  }

  private validateOverrides(overrides: GateOverrides): void {
    if (overrides.plateNumber !== undefined && normalizePlate(overrides.plateNumber).length < 4) {
      throw new BadRequestException("Biển số chỉnh sửa không hợp lệ.");
    }
    if (overrides.vehicleType !== undefined && findVehicleProfile(overrides.vehicleType) === undefined) {
      throw new BadRequestException("Loại xe không có trong danh mục.");
    }
    if (overrides.material !== undefined && !isKnownMaterial(overrides.material)) {
      throw new BadRequestException("Loại đá không có trong danh mục.");
    }
  }

  private captureFromDetection(job: VideoJob, detection: DetectionResult, capturedAt: string): GatePass["capture"] {
    const evidenceSeconds = Number.isFinite(Number(detection.evidenceSeconds)) ? Number(detection.evidenceSeconds) : 0;
    return {
      source: "video",
      videoJobId: job.id,
      cameraId: "upload",
      clockSource: "server",
      capturedAt,
      mediaTimeSec: evidenceSeconds,
      overviewUrl: detection.evidenceSnapshotUrl ?? detection.snapshotUrl,
      plateCropUrl: detection.snapshotUrl,
      vehicleImageUrl: detection.vehicleImageUrl ?? null,
      loadImageUrl: detection.loadImageUrl ?? null,
      vehicleBox: detection.vehicleBox ?? null,
      loadBox: detection.loadBox ?? null,
      trackId: detection.trackId ?? detection.plateNumber,
      trail: detection.trail ?? [],
      plateText: detection.plateNumber,
      plateNormalized: normalizePlate(detection.plateNumber),
      ocrConfidence: detection.ocrConfidence ?? null,
      detectorConfidence: detection.detectorConfidence ?? null,
      plateRegion: detection.plateRegion ?? null
    };
  }

  private registerPass(
    capture: GatePass["capture"],
    vehicleType: Classification,
    material: Classification,
    id: string = randomUUID()
  ): GatePass {
    const now = new Date().toISOString();
    const pass: GatePass = {
      id,
      createdAt: now,
      updatedAt: now,
      capture,
      vehicleType,
      material,
      weighing: null,
      checks: [],
      status: "WAITING_WEIGHT",
      resolution: "PENDING",
      overrides: {},
      effective: { plateNumber: capture.plateText, vehicleType: vehicleType.code, material: material.code },
      audit: []
    };
    this.refresh(pass);
    this.pushAudit(pass, "system", "capture", null, null, { plate: capture.plateText, source: capture.source });
    this.passes.set(id, pass);

    // Phiếu cân có thể đến trước khi camera xử lý xong.
    for (const reading of this.readings.values()) {
      if (reading.gatePassId === null && matchScore(pass, reading, this.config.matchWindowSeconds) !== null) {
        this.attachReading(pass, reading, "system", null);
        break;
      }
    }
    this.events.next({ type: "upsert", pass });
    return pass;
  }

  private attachReading(pass: GatePass, reading: WeighReading, actor: string, reason: string | null): void {
    const current = pass.weighing;
    if (
      current !== null &&
      ((current.grossKg !== null && reading.grossKg !== null) || (current.tareKg !== null && reading.tareKg !== null))
    ) {
      throw new ConflictException("Lượt xe đã có lần cân này.");
    }

    const grossKg = reading.grossKg ?? current?.grossKg ?? null;
    const tareKg = reading.tareKg ?? current?.tareKg ?? null;
    const summary: WeighSummary = {
      scaleId: current?.scaleId ?? reading.scaleId,
      ticketNo: current?.ticketNo ?? reading.ticketNo,
      plateNumber: current?.plateNumber ?? reading.plateNumber,
      grossKg,
      tareKg,
      netKg: grossKg !== null && tareKg !== null ? grossKg - tareKg : null,
      grossAt: reading.grossKg !== null ? reading.measuredAt : (current?.grossAt ?? null),
      tareAt: reading.tareKg !== null ? reading.measuredAt : (current?.tareAt ?? null),
      firstMeasuredAt: current?.firstMeasuredAt ?? reading.measuredAt,
      readingIds: [...(current?.readingIds ?? []), reading.id],
      source: current?.source ?? reading.source
    };
    reading.gatePassId = pass.id;
    pass.weighing = summary;
    this.refresh(pass);
    this.pushAudit(pass, actor, "link_weighing", reason, null, {
      readingId: reading.id,
      grossKg: reading.grossKg,
      tareKg: reading.tareKg,
      netKg: summary.netKg,
      status: pass.status
    });
    this.events.next({ type: "upsert", pass });
  }

  private refresh(pass: GatePass): void {
    pass.effective = {
      plateNumber: pass.overrides.plateNumber ?? pass.capture.plateText,
      vehicleType: pass.overrides.vehicleType ?? pass.vehicleType.code,
      material: pass.overrides.material ?? pass.material.code
    };
    pass.checks = runChecks(pass, this.config);
    pass.status = deriveStatus(pass.checks, pass.weighing);
    pass.updatedAt = new Date().toISOString();
  }

  private pushAudit(
    pass: GatePass,
    actor: string,
    action: string,
    reason: string | null,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ): void {
    const entry: AuditEntry = { at: new Date().toISOString(), actor, action, reason, before, after };
    pass.audit.push(entry);
  }
}

function stripUndefined(overrides: GateOverrides): GateOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as GateOverrides;
}
