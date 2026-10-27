import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Subject } from "rxjs";
import { randomUUID } from "node:crypto";
import { findVehicleProfile, isKnownMaterial } from "./gate.catalog";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassRepository } from "./gate-pass.repository";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WeighReadingRepository } from "./weigh-reading.repository";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MasterDataService } from "./master-data.service";
import { NO_MASTER_LINK } from "./master.types";
import { randomDemoPlate, randomDemoShots, randomNetKg, randomTareKg } from "./gate.mock";
import type { AuditEntry, CaptureAttempt, CaptureShot, Classification, DetectionInput, GateOverrides, GatePass, PlateCapture, WeighReading, WeighSummary } from "./gate.types";
import {
  computeVisitStatus,
  deriveReasons,
  deriveStatus,
  matchScore,
  secondWeighScore,
  normalizePlate,
  readVerificationConfig,
  runChecks
} from "./gate.verification";

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

export type ClearScope = "resolved" | "all";

export type GateEvent = { type: "upsert"; pass: GatePass } | { type: "remove"; id: string };

/** Tham số cho mô phỏng (nút "Mô phỏng cân + chụp" ở dashboard và DemoSeedService) — đi qua đúng luồng thật
 *  (resolvePassForWeighSignal + openCaptureWindow + submitCaptureResult), không phải code riêng. */
export interface SimulateOptions {
  plateNumber?: string;
  scaleId?: string;
  tareKg?: number;
  grossKg?: number;
  shotCount?: number;
  forceCaptureFailure?: boolean;
  shots?: CaptureShot[];
}

interface PendingCapture {
  expected: number;
  deadlineAt: string;
  timer: NodeJS.Timeout;
  /** Lượt vào (chưa có weighing trước đó) ghi vào `capture`; lượt ra (đã có weighing) ghi vào `exitCapture` —
   *  giữ đúng ngữ nghĩa cũ của 2 field này (xem PlateCapture ở gate.types.ts). */
  target: "capture" | "exitCapture";
}

const UNAVAILABLE: Classification = { code: null, confidence: null, source: "unavailable" };

/**
 * Postgres là nguồn dữ liệu duy nhất (xem GatePassRepository). Service giữ vài Map transient, thuần tuý để
 * điều phối trong lúc một phiên đang chạy — không phải dữ liệu nghiệp vụ, không cần và không nên sống sót
 * qua một lần khởi động lại:
 *   - passByTrack/exitTracks: luồng camera continuous-detection CŨ (ingestDetection) — vẫn giữ nguyên, không
 *     xoá, nhưng python/detect/pipeline.py không còn gọi theo đường này nữa (xem openCaptureWindow bên dưới).
 *   - pendingCaptures: luồng MỚI cân-trước-chụp-sau — passId → đợt chờ ảnh đang mở (xem openCaptureWindow/
 *     submitCaptureResult/finalizeCapture).
 */
@Injectable()
export class GatePassesService {
  private readonly logger = new Logger(GatePassesService.name);
  private readonly config = readVerificationConfig();
  private readonly passByTrack = new Map<string, string>();
  private readonly exitTracks = new Set<string>();
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  /** Luồng sự kiện cho realtime (SSE). */
  public readonly events = new Subject<GateEvent>();

  public constructor(
    private readonly master: MasterDataService,
    private readonly passes: GatePassRepository,
    private readonly readings: WeighReadingRepository
  ) {
    // Đối chiếu lại các lượt đang chờ xử lý mỗi khi master data đổi (tài xế/xe trong bãi thêm/sửa/xoá).
    master.changes.subscribe(() => void this.refreshAllPending());
  }

  public listPasses(): Promise<GatePass[]> {
    return this.passes.list();
  }

  public async getPass(id: string): Promise<GatePass> {
    const pass = await this.passes.findById(id);
    if (pass === null) {
      throw new NotFoundException("Không tìm thấy lượt xe.");
    }
    return pass;
  }

  /** Xoá bản ghi của lượt xe. */
  public async clear(scope: ClearScope | string): Promise<{ removed: number }> {
    const resolutions: GatePass["resolution"][] = scope === "all" ? ["PENDING", "CONFIRMED", "REJECTED"] : ["CONFIRMED", "REJECTED"];
    const targets = await this.passes.list();
    const matching = targets.filter((pass) => resolutions.includes(pass.resolution));
    for (const pass of matching) {
      this.forgetTrack(pass.id);
      this.forgetCapture(pass.id);
      this.events.next({ type: "remove", id: pass.id });
    }
    await this.passes.deleteMany(matching.map((pass) => pass.id));
    if (scope === "all") {
      await this.readings.deleteAll();
    }
    this.logger.log(`gate-clear scope=${scope} removed=${matching.length}`);
    return { removed: matching.length };
  }

  public async remove(id: string): Promise<{ removed: number }> {
    const pass = await this.getPass(id);
    await this.readings.deleteByIds(pass.weighing?.readingIds ?? []);
    await this.passes.delete(id);
    this.forgetTrack(id);
    this.forgetCapture(id);
    this.events.next({ type: "remove", id });
    return { removed: 1 };
  }

  private forgetTrack(passId: string): void {
    for (const [trackKey, mappedId] of this.passByTrack) {
      if (mappedId === passId) {
        this.passByTrack.delete(trackKey);
        this.exitTracks.delete(trackKey);
      }
    }
  }

  private forgetCapture(passId: string): void {
    const window = this.pendingCaptures.get(passId);
    if (window !== undefined) {
      clearTimeout(window.timer);
      this.pendingCaptures.delete(passId);
    }
  }

  public listReadings(): Promise<WeighReading[]> {
    return this.readings.list();
  }

  /**
   * Nhận biển số từ worker (realtime). Một track mới (biển số chưa gặp trong video này) được coi là một lượt
   * camera nhìn thấy xe — kiểm tra biển này có lượt nào đang mở (đã vào, chưa ra) không:
   *   - Có: đây là lượt xe RA, ghép tiếp vào đúng record cũ (một record giữ cả vào lẫn ra).
   *   - Không (lần đầu, hoặc lượt trước đã vào/ra xong rồi): đây là lượt xe VÀO, tạo record mới.
   * Các lần sau cùng track (python chốt biển số tốt hơn) chỉ cập nhật đúng phía vào/ra của record đó.
   */
  public async ingestDetection(detection: DetectionInput): Promise<GatePass> {
    const trackKey = `${detection.cameraId}:${detection.trackId ?? detection.plateNumber}`;
    const existingId = this.passByTrack.get(trackKey);
    const existing = existingId === undefined ? null : await this.passes.findById(existingId);

    if (existing === null) {
      const openPass = await this.findOpenPassByPlate(normalizePlate(detection.plateNumber));
      if (openPass !== undefined) {
        this.passByTrack.set(trackKey, openPass.id);
        this.exitTracks.add(trackKey);
        openPass.exitCapture = this.captureFromDetection(detection, new Date().toISOString());
        this.pushAudit(openPass, "system", "exit_sighting", null, null, { trackKey, plate: detection.plateNumber });
        await this.refresh(openPass);
        await this.mockExitWeigh(openPass);
        return openPass;
      }
      const capture = this.captureFromDetection(detection, new Date().toISOString());
      const pass = await this.registerPass(capture, detection.vehicleType ?? UNAVAILABLE, detection.material ?? UNAVAILABLE);
      this.passByTrack.set(trackKey, pass.id);
      await this.mockEntryWeigh(pass);
      return pass;
    }
    if (existing.resolution !== "PENDING") {
      return existing;
    }
    if (this.exitTracks.has(trackKey)) {
      // Track của lượt RA: refine lại biển số lúc ra (giữ nguyên thời điểm chụp lúc ra ban đầu).
      existing.exitCapture = this.captureFromDetection(detection, existing.exitCapture?.capturedAt ?? new Date().toISOString());
      if (detection.final === true) {
        this.pushAudit(existing, "system", "exit_capture_final", null, null, { plate: existing.exitCapture.plateText });
      }
      return this.refresh(existing);
    }

    const plateChanged = existing.capture.plateText !== detection.plateNumber;
    existing.capture = this.captureFromDetection(detection, existing.capture.capturedAt);
    existing.vehicleType = detection.vehicleType ?? UNAVAILABLE;
    existing.material = detection.material ?? UNAVAILABLE;
    // Cân giả lập luôn "đọc" đúng biển camera; khi biển được chốt lại thì cân theo biển mới.
    if (plateChanged && existing.weighing?.source === "mock") {
      existing.weighing.plateNumber = detection.plateNumber;
    }
    if (detection.final === true) {
      this.pushAudit(existing, "system", "capture_final", null, null, { plate: existing.capture.plateText });
    }
    return this.refresh(existing);
  }

  /**
   * Lượt đang mở (đã vào, chưa ra, chưa bị từ chối/xác nhận) gần nhất của một biển số, nếu có.
   * Giới hạn trong `secondWeighWindowSeconds` kể từ lúc vào — không giới hạn thời gian thì một lượt cũ
   * không có cân (ví dụ video test không bật cân) sẽ "bẫy" mọi video sau này có cùng biển số, coi nhầm là
   * xe ra của lượt cũ thay vì tạo lượt mới cho video đó.
   */
  private async findOpenPassByPlate(plateNormalized: string): Promise<GatePass | undefined> {
    const nowMs = Date.now();
    const pending = await this.passes.findPending();
    let best: GatePass | undefined;
    for (const pass of pending) {
      if (pass.visitStatus === "EXITED") {
        continue;
      }
      if (normalizePlate(pass.effective.plateNumber) !== plateNormalized) {
        continue;
      }
      const ageSeconds = (nowMs - Date.parse(pass.capture.capturedAt)) / 1000;
      if (!Number.isFinite(ageSeconds) || ageSeconds > this.config.secondWeighWindowSeconds) {
        continue;
      }
      if (best === undefined || pass.capture.capturedAt > best.capture.capturedAt) {
        best = pass;
      }
    }
    return best;
  }

  /**
   * Cân giả lập lúc xe vào (xe trống): hard code, chưa có trạm cân thật, bật bằng WEIGHBRIDGE_MOCK_RANDOM=true (mặc định đang tắt).
   * Gắn theo luồng camera continuous-detection CŨ (ingestDetection, đã biết biển số) — ghép theo biển số qua
   * matchReadingByPlate(), KHÔNG mở đợt chờ ảnh (openCaptureWindow) như luồng cân-trước-chụp-sau mới, để không
   * đè ảnh continuous-detection đã có bằng một đợt chờ ảnh không bao giờ được trả lời.
   */
  private async mockEntryWeigh(pass: GatePass): Promise<void> {
    if (process.env.WEIGHBRIDGE_MOCK_RANDOM !== "true") {
      return;
    }
    const base = { scaleId: "SCALE-MOCK", ticketNo: `M${Date.now().toString(36).toUpperCase()}`, plateNumber: pass.capture.plateText };
    await this.matchReadingByPlate({ ...base, grossKg: null, tareKg: randomTareKg(), measuredAt: new Date().toISOString() }, "mock");
  }

  /** Cân giả lập lúc xe ra (đã chở đá lên): gross = tare lúc vào + hàng random, để net luôn hợp lý. */
  private async mockExitWeigh(pass: GatePass): Promise<void> {
    if (process.env.WEIGHBRIDGE_MOCK_RANDOM !== "true") {
      return;
    }
    const tareKg = pass.weighing?.tareKg ?? randomTareKg();
    const base = { scaleId: "SCALE-MOCK", ticketNo: `M${Date.now().toString(36).toUpperCase()}`, plateNumber: pass.capture.plateText };
    await this.matchReadingByPlate({ ...base, grossKg: tareKg + randomNetKg(), tareKg: null, measuredAt: new Date().toISOString() }, "mock");
  }

  /**
   * Luồng camera continuous-detection CŨ: ghép số liệu cân với lượt xe đang chờ (đã vào, chưa ra) gần nhất
   * THEO BIỂN SỐ — biển số đã biết từ trước (camera chạy liên tục, độc lập với cân). Không có lượt nào đang
   * chờ thì tạo lượt mới, coi số liệu này là cân đầu vào. Chỉ dùng cho mockEntryWeigh/mockExitWeigh (giữ
   * nguyên hành vi cũ) — luồng MỚI (ingestReading/simulateWeighAndCapture) dùng resolvePassForWeighSignal
   * (theo trạm cân, không theo biển số — xem đó để biết lý do: cân xong mới chụp nên lúc cân CHƯA có biển số).
   */
  private async matchReadingByPlate(input: ReadingInput, source: WeighReading["source"]): Promise<WeighReading> {
    const reading = await this.readings.create({ ...input, source });
    const pending = await this.passes.findPending();
    let best: { pass: GatePass; score: number } | null = null;
    for (const pass of pending) {
      const score = pass.weighing === null ? matchScore(pass, reading, this.config.matchWindowSeconds) : secondWeighScore(pass, reading, this.config.secondWeighWindowSeconds);
      if (score !== null && (best === null || score > best.score)) {
        best = { pass, score };
      }
    }
    if (best !== null) {
      await this.attachReading(best.pass, reading, "system", null);
    } else if (reading.plateNumber !== null && normalizePlate(reading.plateNumber).length >= 4) {
      await this.createFromReading(reading);
    } else {
      this.logger.warn(`weigh-reading unmatched id=${reading.id} ticket=${reading.ticketNo ?? "-"}`);
    }
    return reading;
  }

  /**
   * Luồng MỚI cân-trước-chụp-sau: ghép số liệu cân THEO TRẠM CÂN (scaleId), không theo biển số — lúc cân
   * xong còn chưa biết biển số (biển số chỉ có SAU khi camera chụp, xem openCaptureWindow/submitCaptureResult).
   * Một trạm cân chỉ có đúng 1 xe trên bàn cân một lúc, nên "lượt đang mở của đúng trạm này, cân lần gần nhất
   * trong vòng GATE_MATCH_WINDOW_SECONDS" coi là cùng một xe (lần cân thứ hai — lượt RA); quá cửa sổ đó (xe đã
   * rời bàn cân đi nơi khác rồi mới quay lại) thì luôn tạo lượt mới (lượt VÀO), dù có thể trùng xe thật ngoài
   * đời — hạn chế đã biết khi không còn biển số để phân biệt, xem ARCHITECTURE.md.
   */
  private async resolvePassForWeighSignal(input: ReadingInput, source: WeighReading["source"]): Promise<{ reading: WeighReading; pass: GatePass; isSecondLeg: boolean }> {
    const reading = await this.readings.create({ ...input, source });
    const openForScale = await this.findOpenPassForScale(input.scaleId, Date.parse(reading.measuredAt));
    if (openForScale !== undefined) {
      await this.attachReading(openForScale, reading, "system", null);
      return { reading, pass: openForScale, isSecondLeg: true };
    }
    const capture = this.captureFromReading(reading);
    const pass = await this.registerPass(capture, UNAVAILABLE, UNAVAILABLE, { autoMatchReadings: false });
    await this.attachReading(pass, reading, "system", null);
    return { reading, pass, isSecondLeg: false };
  }

  /** Lượt đang "mở" (đã vào, chưa ra) của đúng trạm cân này, cân lần gần nhất trong vòng
   *  GATE_MATCH_WINDOW_SECONDS — xem resolvePassForWeighSignal. */
  private async findOpenPassForScale(scaleId: string, atMs: number): Promise<GatePass | undefined> {
    const pending = await this.passes.findPending();
    let best: GatePass | undefined;
    for (const pass of pending) {
      if (pass.visitStatus === "EXITED" || pass.weighing === null || pass.weighing.scaleId !== scaleId) {
        continue;
      }
      // Lần cân GẦN NHẤT của lượt này — không theo thứ tự field (tare/gross cái nào tới sau mới là "gần nhất").
      const lastAt = [pass.weighing.tareAt, pass.weighing.grossAt].filter((value): value is string => value !== null).sort().pop() ?? pass.weighing.firstMeasuredAt;
      const gapSeconds = Math.abs(atMs - Date.parse(lastAt)) / 1000;
      if (!Number.isFinite(gapSeconds) || gapSeconds > this.config.matchWindowSeconds) {
        continue;
      }
      if (best === undefined || pass.weighing.firstMeasuredAt > best.weighing!.firstMeasuredAt) {
        best = pass;
      }
    }
    return best;
  }

  /** Điểm vào của hệ thống cân ngoài (và nền của nút "Mô phỏng cân + chụp"): ghép theo trạm cân rồi mở ngay
   *  một đợt chờ ảnh camera — đúng luồng mới "cân xong mới chụp" (xem resolvePassForWeighSignal). */
  public async ingestReading(input: ReadingInput, source: WeighReading["source"] = "external"): Promise<WeighReading> {
    const { reading, pass, isSecondLeg } = await this.resolvePassForWeighSignal(input, source);
    await this.openCaptureWindow(pass.id, isSecondLeg ? "exitCapture" : "capture");
    return reading;
  }

  /**
   * Demo/thử nghiệm: mô phỏng đúng luồng cân-trước-chụp-sau — không phải code riêng, đi qua đúng
   * resolvePassForWeighSignal/openCaptureWindow/submitCaptureResult như cân/camera thật. Dùng cho nút
   * "Mô phỏng cân + chụp" (không truyền gì — tự biết cân vào hay cân ra, xem dưới) và DemoSeedService
   * (truyền tham số cụ thể để dựng đủ các trạng thái mẫu).
   *
   * Không truyền grossKg/tareKg: tự quyết theo trạng thái trạm cân, giống bấm nút thật mỗi lần 1 xe đi qua —
   * đang có xe "mở" trên trạm (vừa cân vào, chưa ra) thì đây là lần cân RA (gross) để khép lượt đó lại; nếu
   * không thì đây là lần cân VÀO (tare) của một xe mới. Không tự làm vậy thì bấm nút 2 lần liên tiếp sẽ bị
   * coi là 2 lần cân vào của cùng một "lượt đang mở" và bị từ chối (đã có lần cân này).
   */
  public async simulateWeighAndCapture(options: SimulateOptions = {}): Promise<GatePass> {
    const scaleId = options.scaleId ?? "SCALE-01";
    let grossKg: number | null = null;
    let tareKg: number | null = null;
    let openPass: GatePass | undefined;
    if (options.grossKg !== undefined || options.tareKg !== undefined) {
      grossKg = options.grossKg ?? null;
      tareKg = options.tareKg ?? null;
    } else {
      openPass = await this.findOpenPassForScale(scaleId, Date.now());
      if (openPass !== undefined) {
        grossKg = (openPass.weighing?.tareKg ?? randomTareKg()) + randomNetKg();
      } else {
        tareKg = randomTareKg();
      }
    }
    const { pass, isSecondLeg } = await this.resolvePassForWeighSignal(
      {
        scaleId,
        ticketNo: `SIM${Date.now().toString(36).toUpperCase()}`,
        plateNumber: null,
        grossKg,
        tareKg,
        measuredAt: new Date().toISOString()
      },
      "mock"
    );
    await this.openCaptureWindow(pass.id, isSecondLeg ? "exitCapture" : "capture");

    // Lượt RA (isSecondLeg) mà xe đã có biển từ lượt vào thì chụp lại đúng biển đó, cho giống thật.
    const plateNumber = options.plateNumber ?? (isSecondLeg && pass.capture.plateText !== "" ? pass.capture.plateText : randomDemoPlate());
    const expected = Math.max(1, Number(process.env.CAPTURE_EXPECTED_SHOTS ?? 4));
    const shots = options.shots ?? randomDemoShots(plateNumber, options.shotCount ?? expected, options.forceCaptureFailure);
    let result = pass;
    for (const shot of shots) {
      result = await this.submitCaptureResult(result.id, shot);
    }
    return result;
  }

  /** Mở một đợt chờ ảnh mới cho `passId` (tối đa CAPTURE_EXPECTED_SHOTS camera, hết CAPTURE_TIMEOUT_SECONDS
   *  giây mà chưa đủ ảnh dùng được thì finalizeCapture tự chốt CAPTURE_FAILED). Đè lên đợt cũ nếu còn mở. */
  private async openCaptureWindow(passId: string, target: "capture" | "exitCapture"): Promise<void> {
    this.forgetCapture(passId);
    const pass = await this.getPass(passId);
    pass.captureState = "pending";
    pass.captureAttempts = [];
    await this.refresh(pass);
    const expected = Math.max(1, Number(process.env.CAPTURE_EXPECTED_SHOTS ?? 4));
    const timeoutMs = Math.max(1, Number(process.env.CAPTURE_TIMEOUT_SECONDS ?? 20)) * 1000;
    const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();
    const timer = setTimeout(() => void this.finalizeCapture(passId), timeoutMs);
    this.pendingCaptures.set(passId, { expected, deadlineAt, timer, target });
  }

  /** Đợt chờ ảnh đang mở của một trạm cân (nếu có) — mỗi tiến trình camera (python/detect/pipeline.py) polling
   *  GET /gate/capture-requests/pending để biết có cần chụp ngay không. */
  public async findPendingCaptureByScale(scaleId: string): Promise<{ passId: string; deadlineAt: string } | null> {
    for (const [passId, window] of this.pendingCaptures) {
      const pass = await this.passes.findById(passId);
      if (pass !== null && pass.weighing?.scaleId === scaleId) {
        return { passId, deadlineAt: window.deadlineAt };
      }
    }
    return null;
  }

  /** Một camera gửi kết quả cho đợt chờ ảnh đang mở của `passId`. Đủ số camera mong đợi thì chốt ngay. */
  public async submitCaptureResult(passId: string, shot: CaptureShot): Promise<GatePass> {
    const pass = await this.getPass(passId);
    if (pass.captureState !== "pending") {
      throw new ConflictException("Lượt xe này không có đợt chờ ảnh đang mở.");
    }
    const attempt: CaptureAttempt = {
      cameraId: shot.cameraId,
      plateNumber: shot.plateNumber,
      ocrConfidence: shot.ocrConfidence,
      detectorConfidence: shot.detectorConfidence,
      vehicleType: shot.vehicleType ?? null,
      material: shot.material ?? null,
      imageUrl: shot.imageUrl ?? null,
      quality: shot.quality
    };
    pass.captureAttempts = [...pass.captureAttempts, attempt];
    await this.passes.save(pass);
    const window = this.pendingCaptures.get(passId);
    if (window !== undefined && pass.captureAttempts.length >= window.expected) {
      const finalized = await this.finalizeCapture(passId);
      if (finalized === null) {
        throw new NotFoundException("Không tìm thấy lượt xe.");
      }
      return finalized;
    }
    return pass;
  }

  /**
   * Hết giờ chờ hoặc đã đủ ảnh: chọn shot "ok" có OCR cao nhất làm biển số chính thức; loại xe/loại đá lấy
   * riêng từ shot có confidence cao nhất (có thể là camera khác). Không shot nào "ok" → captureState="failed"
   * (CAPTURE_FAILED, "cần kiểm tra lại") nhưng vẫn giữ captureAttempts để người vận hành xem ảnh + nhập tay
   * qua ResolvePanel có sẵn — không xoá dữ liệu cân đã có. Lượt RA (target="exitCapture") chỉ ghi exitCapture,
   * giữ nguyên vehicleType/material đã có từ lượt VÀO, đúng ngữ nghĩa cũ của ingestDetection's "exit_sighting".
   */
  private async finalizeCapture(passId: string): Promise<GatePass | null> {
    const window = this.pendingCaptures.get(passId);
    const target = window?.target ?? "capture";
    this.forgetCapture(passId);
    const pass = await this.passes.findById(passId);
    if (pass === null || pass.captureState !== "pending") {
      return pass;
    }

    const usable = pass.captureAttempts.filter((attempt) => attempt.quality === "ok" && attempt.plateNumber !== null);
    if (usable.length === 0) {
      pass.captureState = "failed";
      this.pushAudit(pass, "system", "capture_failed", null, null, { target, attempts: pass.captureAttempts.length });
      return this.refresh(pass);
    }

    const best = usable.reduce((a, b) => ((b.ocrConfidence ?? 0) > (a.ocrConfidence ?? 0) ? b : a));
    const plateText = best.plateNumber ?? "";
    const newCapture: PlateCapture = {
      source: "video",
      cameraId: best.cameraId,
      clockSource: "server",
      capturedAt: pass.capture.capturedAt,
      trackId: `capture-${pass.id}`,
      plateText,
      plateNormalized: normalizePlate(plateText),
      ocrConfidence: best.ocrConfidence,
      detectorConfidence: best.detectorConfidence,
      imageUrl: best.imageUrl
    };

    pass.captureState = null;
    if (target === "exitCapture") {
      pass.exitCapture = newCapture;
    } else {
      pass.capture = newCapture;
      const bestVehicle = pass.captureAttempts.reduce<CaptureAttempt | null>(
        (acc, attempt) => (attempt.vehicleType !== null && (acc === null || (attempt.vehicleType.confidence ?? 0) > (acc.vehicleType?.confidence ?? 0)) ? attempt : acc),
        null
      );
      const bestMaterial = pass.captureAttempts.reduce<CaptureAttempt | null>(
        (acc, attempt) => (attempt.material !== null && (acc === null || (attempt.material.confidence ?? 0) > (acc.material?.confidence ?? 0)) ? attempt : acc),
        null
      );
      pass.vehicleType = bestVehicle?.vehicleType ?? UNAVAILABLE;
      pass.material = bestMaterial?.material ?? UNAVAILABLE;
    }
    this.pushAudit(pass, "system", "capture_complete", null, null, { target, plate: plateText, cameras: pass.captureAttempts.length });
    return this.refresh(pass);
  }

  public async linkReading(passId: string, readingId: string, actor: string, reason: string | null): Promise<GatePass> {
    const pass = await this.getPass(passId);
    const reading = await this.readings.findById(readingId);
    if (reading === null) {
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
    await this.attachReading(pass, reading, actor, reason);
    return pass;
  }

  public async resolve(id: string, decision: "CONFIRMED" | "REJECTED", input: ResolveInput): Promise<GatePass> {
    const pass = await this.getPass(id);
    if (pass.resolution !== "PENDING") {
      throw new ConflictException("Lượt xe đã được xử lý.");
    }

    const hasOverride = Object.values(input.overrides).some((value) => value !== undefined);
    const acceptsUnverified = decision === "CONFIRMED" && pass.status !== "VERIFIED";
    if ((decision === "REJECTED" || hasOverride || acceptsUnverified) && input.reason === null) {
      throw new BadRequestException("Từ chối, chỉnh sửa kết quả AI hoặc xác nhận lượt chưa đạt kiểm tra bắt buộc ghi lý do.");
    }
    if (decision === "CONFIRMED" && (pass.status === "WAITING_WEIGHT" || pass.status === "WAITING_SECOND_WEIGH" || pass.status === "WAITING_CAPTURE")) {
      throw new ConflictException("Lượt xe chưa đủ dữ liệu (cân hoặc ảnh chụp), không thể xác nhận.");
    }
    this.validateOverrides(input.overrides);

    const before = { ...pass.effective };
    pass.overrides = { ...pass.overrides, ...stripUndefined(input.overrides) };
    this.recomputeFields(pass);
    pass.resolution = decision;
    this.pushAudit(pass, input.actor, decision === "CONFIRMED" ? "confirm" : "reject", input.reason, before, {
      ...pass.effective
    });
    const saved = await this.passes.save(pass);
    this.events.next({ type: "upsert", pass: saved });
    return saved;
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

  private captureFromDetection(detection: DetectionInput, capturedAt: string): GatePass["capture"] {
    return {
      source: "video",
      cameraId: detection.cameraId,
      clockSource: "server",
      capturedAt: detection.capturedAt ?? capturedAt,
      trackId: detection.trackId ?? detection.plateNumber,
      plateText: detection.plateNumber,
      plateNormalized: normalizePlate(detection.plateNumber),
      ocrConfidence: detection.ocrConfidence ?? null,
      detectorConfidence: detection.detectorConfidence ?? null,
      imageUrl: detection.imageUrl ?? null
    };
  }

  /** Lượt không qua nhận diện biển số, tạo thẳng từ một số liệu cân (xem ingestReading). */
  private captureFromReading(reading: WeighReading): GatePass["capture"] {
    const plateText = reading.plateNumber ?? "";
    return {
      source: "weighbridge",
      cameraId: reading.scaleId,
      clockSource: "server",
      capturedAt: reading.measuredAt,
      trackId: `wb-${reading.id}`,
      plateText,
      plateNormalized: normalizePlate(plateText),
      ocrConfidence: null,
      detectorConfidence: null,
      imageUrl: null
    };
  }

  /** Tạo lượt mới (cân đầu vào) từ một số liệu cân chưa ghép được với lượt nào đang mở. */
  private async createFromReading(reading: WeighReading): Promise<GatePass> {
    const capture = this.captureFromReading(reading);
    const pass = await this.registerPass(capture, UNAVAILABLE, UNAVAILABLE, { autoMatchReadings: false });
    await this.attachReading(pass, reading, "system", null);
    this.logger.log(`weigh-reading created new pass id=${pass.id} plate=${capture.plateText || "?"} (không qua nhận diện biển số)`);
    return pass;
  }

  private async registerPass(
    capture: GatePass["capture"],
    vehicleType: Classification,
    material: Classification,
    options: { autoMatchReadings?: boolean } = {}
  ): Promise<GatePass> {
    const draft: GatePass = {
      master: NO_MASTER_LINK,
      id: randomUUID(),
      createdAt: "",
      updatedAt: "",
      captureState: null,
      captureAttempts: [],
      capture,
      exitCapture: null,
      vehicleType,
      material,
      weighing: null,
      checks: [],
      status: "WAITING_WEIGHT",
      statusReasons: [],
      visitStatus: "ENTERED",
      resolution: "PENDING",
      overrides: {},
      effective: { plateNumber: capture.plateText, vehicleType: vehicleType.code, material: material.code },
      audit: []
    };
    this.recomputeFields(draft);
    this.pushAudit(draft, "system", "capture", null, null, { plate: capture.plateText, source: capture.source });
    const pass = await this.passes.create(draft);
    this.events.next({ type: "upsert", pass });

    if (options.autoMatchReadings !== false) {
      // Phiếu cân có thể đến trước khi camera xử lý xong.
      const unattached = await this.readings.findUnattached();
      for (const reading of unattached) {
        if (matchScore(pass, reading, this.config.matchWindowSeconds) !== null) {
          await this.attachReading(pass, reading, "system", null);
          break;
        }
      }
    }
    return pass;
  }

  private async attachReading(pass: GatePass, reading: WeighReading, actor: string, reason: string | null): Promise<void> {
    const current = pass.weighing;
    if (current !== null && ((current.grossKg !== null && reading.grossKg !== null) || (current.tareKg !== null && reading.tareKg !== null))) {
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
    await this.readings.attach(reading.id, pass.id);
    pass.weighing = summary;
    this.pushAudit(pass, actor, "link_weighing", reason, null, {
      readingId: reading.id,
      grossKg: reading.grossKg,
      tareKg: reading.tareKg,
      netKg: summary.netKg,
      status: pass.status
    });
    await this.refresh(pass);
  }

  /** Chạy lại kiểm tra chéo cho mọi lượt đang PENDING — gọi khi master data (xe/tài xế trong bãi) thay đổi. */
  private async refreshAllPending(): Promise<void> {
    const pending = await this.passes.findPending();
    const fingerprint = (pass: GatePass): string => `${pass.status}|${pass.statusReasons.join()}|${pass.visitStatus}|${JSON.stringify(pass.master)}`;
    for (const pass of pending) {
      const before = fingerprint(pass);
      this.recomputeFields(pass);
      if (before !== fingerprint(pass)) {
        const saved = await this.passes.save(pass);
        this.events.next({ type: "upsert", pass: saved });
      }
    }
  }

  private recomputeFields(pass: GatePass): void {
    if (pass.captureState === "pending") {
      // Đang chờ ảnh từ camera (luồng cân-trước-chụp-sau) — chưa có gì để chạy kiểm tra chéo, chỉ set
      // status/visitStatus trực tiếp. Checks/master giữ nguyên giá trị cũ, sẽ tính lại đầy đủ khi
      // finalizeCapture() xong (captureState trở về null hoặc "failed").
      pass.status = "WAITING_CAPTURE";
      pass.statusReasons = deriveReasons(pass.status, pass.checks);
      pass.visitStatus = computeVisitStatus(pass);
      return;
    }
    pass.effective = {
      plateNumber: pass.overrides.plateNumber ?? pass.capture.plateText,
      vehicleType: pass.overrides.vehicleType ?? pass.vehicleType.code,
      material: pass.overrides.material ?? pass.material.code
    };
    pass.master = this.master.lookup(pass.effective.plateNumber);
    pass.checks = runChecks(pass, this.config);
    pass.status = deriveStatus(pass.checks, pass.weighing, pass.master, pass.captureState);
    pass.statusReasons = deriveReasons(pass.status, pass.checks);
    pass.visitStatus = computeVisitStatus(pass);
  }

  /** Tính lại trạng thái rồi lưu xuống Postgres, phát sự kiện realtime. */
  private async refresh(pass: GatePass): Promise<GatePass> {
    this.recomputeFields(pass);
    const saved = await this.passes.save(pass);
    this.events.next({ type: "upsert", pass: saved });
    return saved;
  }

  private pushAudit(pass: GatePass, actor: string, action: string, reason: string | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null): void {
    const entry: AuditEntry = { at: new Date().toISOString(), actor, action, reason, before, after };
    pass.audit.push(entry);
  }
}

function stripUndefined(overrides: GateOverrides): GateOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as GateOverrides;
}
