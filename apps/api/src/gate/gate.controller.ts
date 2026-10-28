import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "../sites/sites.service";
import type { SafeUser } from "../users/user.types";
import { MATERIALS, VEHICLE_PROFILES } from "./gate.catalog";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GateExcelService } from "./gate-excel.service";
import type { ImportRowError } from "./gate-excel.service";
import type { CaptureShot, Classification, DetectionInput, GateOverrides, GatePass, WeighReading } from "./gate.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
import type { ReadingInput, ResolveInput } from "./gate-passes.service";

type JsonBody = Record<string, unknown> | undefined;

function asRecord(body: JsonBody): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Body phải là JSON object.");
  }
  return body;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} phải là chuỗi.`);
  }
  return value.trim() || null;
}

function optionalKg(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 500_000) {
    throw new BadRequestException(`${key} phải là số kg hợp lệ.`);
  }
  return value;
}

function parseReading(body: JsonBody): ReadingInput {
  const record = asRecord(body);
  const grossKg = optionalKg(record, "grossKg");
  const tareKg = optionalKg(record, "tareKg");
  const measuredAt = optionalString(record, "measuredAt") ?? new Date().toISOString();
  if (grossKg === null && tareKg === null) {
    throw new BadRequestException("Cần grossKg hoặc tareKg (mỗi lần cân gửi một trong hai).");
  }
  if (grossKg !== null && tareKg !== null) {
    throw new BadRequestException("Mỗi lần cân chỉ gửi grossKg hoặc tareKg, không gửi cả hai.");
  }
  if (!Number.isFinite(Date.parse(measuredAt))) {
    throw new BadRequestException("measuredAt phải là ISO 8601.");
  }
  const scaleId = optionalString(record, "scaleId");
  if (scaleId === null) {
    throw new BadRequestException("scaleId là bắt buộc — dùng đúng scaleId hiện ở trang Cơ sở.");
  }
  return {
    scaleId,
    ticketNo: optionalString(record, "ticketNo"),
    plateNumber: optionalString(record, "plateNumber"),
    grossKg,
    tareKg,
    measuredAt: new Date(measuredAt).toISOString()
  };
}

function optionalClassification(record: Record<string, unknown>, key: string): Classification | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object") {
    throw new BadRequestException(`${key} phải là object { code, confidence, source }.`);
  }
  const item = value as Record<string, unknown>;
  const code = item.code;
  const confidence = item.confidence;
  const source = item.source;
  if (code !== null && typeof code !== "string") {
    throw new BadRequestException(`${key}.code phải là chuỗi hoặc null.`);
  }
  if (confidence !== null && confidence !== undefined && typeof confidence !== "number") {
    throw new BadRequestException(`${key}.confidence phải là số hoặc null.`);
  }
  if (typeof source !== "string") {
    throw new BadRequestException(`${key}.source là bắt buộc.`);
  }
  return { code: code ?? null, confidence: (confidence as number | undefined) ?? null, source: source as Classification["source"] };
}

function parseDetection(body: JsonBody): DetectionInput {
  const record = asRecord(body);
  const plateNumber = optionalString(record, "plateNumber");
  const cameraId = optionalString(record, "cameraId");
  if (plateNumber === null) {
    throw new BadRequestException("plateNumber là bắt buộc.");
  }
  if (cameraId === null) {
    throw new BadRequestException("cameraId là bắt buộc.");
  }
  const ocrConfidence = record.ocrConfidence;
  const detectorConfidence = record.detectorConfidence;
  if (ocrConfidence !== undefined && ocrConfidence !== null && typeof ocrConfidence !== "number") {
    throw new BadRequestException("ocrConfidence phải là số.");
  }
  if (detectorConfidence !== undefined && detectorConfidence !== null && typeof detectorConfidence !== "number") {
    throw new BadRequestException("detectorConfidence phải là số.");
  }
  const capturedAt = optionalString(record, "capturedAt");
  if (capturedAt !== null && !Number.isFinite(Date.parse(capturedAt))) {
    throw new BadRequestException("capturedAt phải là ISO 8601.");
  }
  return {
    cameraId,
    plateNumber,
    trackId: optionalString(record, "trackId") ?? undefined,
    ocrConfidence: (ocrConfidence as number | null | undefined) ?? null,
    detectorConfidence: (detectorConfidence as number | null | undefined) ?? null,
    vehicleType: optionalClassification(record, "vehicleType"),
    material: optionalClassification(record, "material"),
    capturedAt: capturedAt ?? undefined,
    final: record.final === true,
    imageUrl: optionalString(record, "imageUrl")
  };
}

const SHOT_QUALITIES = ["ok", "blurry", "no_plate"] as const;

/** Một camera (python/detect/pipeline.py ở mode chờ-tín-hiệu-chụp, hoặc nút "Mô phỏng cân + chụp") gửi kết
 *  quả chụp cho POST /gate/passes/:id/capture-result — xem GatePassesService.submitCaptureResult. */
function parseCaptureShot(body: JsonBody): CaptureShot {
  const record = asRecord(body);
  const cameraId = optionalString(record, "cameraId");
  if (cameraId === null) {
    throw new BadRequestException("cameraId là bắt buộc.");
  }
  const quality = record.quality;
  if (typeof quality !== "string" || !SHOT_QUALITIES.includes(quality as (typeof SHOT_QUALITIES)[number])) {
    throw new BadRequestException(`quality phải là một trong: ${SHOT_QUALITIES.join(", ")}.`);
  }
  const ocrConfidence = record.ocrConfidence;
  const detectorConfidence = record.detectorConfidence;
  if (ocrConfidence !== undefined && ocrConfidence !== null && typeof ocrConfidence !== "number") {
    throw new BadRequestException("ocrConfidence phải là số.");
  }
  if (detectorConfidence !== undefined && detectorConfidence !== null && typeof detectorConfidence !== "number") {
    throw new BadRequestException("detectorConfidence phải là số.");
  }
  return {
    cameraId,
    plateNumber: optionalString(record, "plateNumber"),
    ocrConfidence: (ocrConfidence as number | null | undefined) ?? null,
    detectorConfidence: (detectorConfidence as number | null | undefined) ?? null,
    vehicleType: optionalClassification(record, "vehicleType"),
    material: optionalClassification(record, "material"),
    imageUrl: optionalString(record, "imageUrl"),
    quality: quality as CaptureShot["quality"]
  };
}

function parseResolve(body: JsonBody): ResolveInput {
  const record = asRecord(body ?? {});
  const overrides: GateOverrides = {};
  for (const key of ["plateNumber", "vehicleType", "material"] as const) {
    const value = optionalString(record, key);
    if (value !== null) {
      overrides[key] = value;
    }
  }
  return {
    actor: optionalString(record, "actor") ?? "operator",
    reason: optionalString(record, "reason"),
    overrides
  };
}

@Controller("gate")
export class GateController {
  public constructor(
    private readonly gatePasses: GatePassesService,
    private readonly sites: SitesService,
    private readonly excel: GateExcelService
  ) {}

  /** File Excel mẫu để bảo vệ ghi lại các lượt cân tay lúc mất điện, nhập lại khi hệ thống chạy lại. */
  @Get("import-template")
  public async importTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.excel.buildTemplate();
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="mau-nhap-lieu.xlsx"'
    });
    res.send(buffer);
  }

  /** Nhập các lượt đã ghi tay (cân xong cả hai đầu) từ file Excel vào đúng cơ sở đang chọn. */
  @Post("passes/import")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  public async importPasses(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: SafeUser,
    @Query("siteId") siteId?: string
  ): Promise<{ imported: number; errors: ImportRowError[] }> {
    if (file === undefined || file.buffer === undefined) {
      throw new BadRequestException("Thiếu file — chọn file .xlsx đã điền trước khi nhập.");
    }
    const scope = this.sites.resolveSiteScope(user, siteId);
    if ("allSites" in scope) {
      throw new BadRequestException("Chọn 1 cơ sở cụ thể trước khi nhập Excel.");
    }
    const { rows, errors: parseErrors } = await this.excel.parseWorkbook(file.buffer);
    const result = await this.gatePasses.importManualPasses(scope.siteId, rows, user.name);
    return { imported: result.imported, errors: [...parseErrors, ...result.errors].sort((first, second) => first.row - second.row) };
  }

  @Get("catalog")
  public catalog(): { vehicleTypes: { code: string; label: string }[]; materials: { code: string; label: string }[] } {
    return {
      vehicleTypes: VEHICLE_PROFILES.map(({ code, label }) => ({ code, label })),
      materials: MATERIALS
    };
  }

  @Get("passes")
  public listPasses(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass[]> {
    return this.gatePasses.listPasses(this.sites.resolveSiteScope(user, siteId));
  }

  /** scope=resolved (mặc định) chỉ xoá lượt đã xác nhận/từ chối; scope=all xoá cả lượt đang chờ. */
  @Delete("passes")
  public clear(@Query("scope") scope: string | undefined, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<{ removed: number }> {
    if (scope !== undefined && scope !== "resolved" && scope !== "all") {
      throw new BadRequestException("scope phải là resolved hoặc all.");
    }
    return this.gatePasses.clear(scope ?? "resolved", this.sites.resolveSiteScope(user, siteId));
  }

  @Delete("passes/:id")
  public remove(@Param("id") id: string, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<{ removed: number }> {
    return this.gatePasses.remove(id, this.sites.resolveSiteScope(user, siteId));
  }

  @Get("passes/:id")
  public getPass(@Param("id") id: string, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass> {
    return this.gatePasses.getPass(id, this.sites.resolveSiteScope(user, siteId));
  }

  /** Lớp Python (nhận diện biển số, phân loại xe/vật liệu) đẩy từng lượt nhận diện về đây — máy gọi máy,
   *  không qua cookie đăng nhập, nên phải @Public() (không có auth riêng, giữ như trước khi có đăng nhập).
   *  Site tự suy ra từ cameraId (xem GatePassesService.ingestDetection). */
  @Public()
  @Post("detections")
  @HttpCode(200)
  public ingestDetection(@Body() body: JsonBody): Promise<GatePass> {
    return this.gatePasses.ingestDetection(parseDetection(body));
  }

  @Post("passes/:id/confirm")
  @HttpCode(200)
  public confirm(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass> {
    return this.gatePasses.resolve(id, "CONFIRMED", parseResolve(body), this.sites.resolveSiteScope(user, siteId));
  }

  @Post("passes/:id/reject")
  @HttpCode(200)
  public reject(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass> {
    return this.gatePasses.resolve(id, "REJECTED", parseResolve(body), this.sites.resolveSiteScope(user, siteId));
  }

  @Post("passes/:id/link-reading")
  @HttpCode(200)
  public linkReading(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass> {
    const record = asRecord(body);
    const readingId = optionalString(record, "readingId");
    if (readingId === null) {
      throw new BadRequestException("readingId là bắt buộc.");
    }
    return this.gatePasses.linkReading(
      id,
      readingId,
      optionalString(record, "actor") ?? "operator",
      optionalString(record, "reason"),
      this.sites.resolveSiteScope(user, siteId)
    );
  }

  @Get("readings")
  public listReadings(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<WeighReading[]> {
    return this.gatePasses.listReadings(this.sites.resolveSiteScope(user, siteId));
  }

  /** Hệ thống cân bên ngoài đẩy số liệu về đây — ghép theo trạm cân rồi mở ngay một đợt chờ ảnh camera
   *  (xem GatePassesService.ingestReading). Site tự suy ra từ scaleId; X-Weighbridge-Key so với đúng
   *  weighbridgeApiKey của site đó (không còn WEIGHBRIDGE_API_KEY global). Máy gọi máy, không qua cookie. */
  @Public()
  @Post("weighbridge/readings")
  @HttpCode(201)
  public ingest(@Headers("x-weighbridge-key") key: string | undefined, @Body() body: JsonBody): Promise<WeighReading> {
    const input = parseReading(body);
    const site = this.sites.resolveByScaleId(input.scaleId);
    if (site === undefined) {
      throw new BadRequestException(`scaleId "${input.scaleId}" chưa đăng ký cho cơ sở nào.`);
    }
    if (site.weighbridgeApiKey !== key) {
      throw new ForbiddenException("API key trạm cân không hợp lệ.");
    }
    return this.gatePasses.ingestReading(input);
  }

  /** Mỗi tiến trình camera (python/detect/pipeline.py, 1 process = 1 camera) polling cái này để biết có cần
   *  chụp ngay không — xem GatePassesService.findPendingCaptureByScale. Máy gọi máy, không qua cookie. */
  @Public()
  @Get("capture-requests/pending")
  public pendingCapture(@Query("scaleId") scaleId: string | undefined): Promise<{ passId: string; deadlineAt: string } | null> {
    if (scaleId === undefined || scaleId.trim() === "") {
      throw new BadRequestException("scaleId là bắt buộc.");
    }
    return this.gatePasses.findPendingCaptureByScale(scaleId.trim());
  }

  /** Một camera trả kết quả chụp cho đợt chờ ảnh đang mở của lượt xe `id`. Máy gọi máy, không qua cookie. */
  @Public()
  @Post("passes/:id/capture-result")
  @HttpCode(200)
  public captureResult(@Param("id") id: string, @Body() body: JsonBody): Promise<GatePass> {
    return this.gatePasses.submitCaptureResult(id, parseCaptureShot(body));
  }

  /** Demo/thử nghiệm: mô phỏng cân + chụp (nút "Mô phỏng cân + chụp" ở dashboard) — đi qua đúng luồng thật,
   *  trong đúng cơ sở người dùng đang chọn (siteId bắt buộc với USER có >1 cơ sở; ADMIN phải chọn 1 site cụ
   *  thể, không mô phỏng được ở "Tất cả"). */
  @Post("simulate/weigh-and-capture")
  @HttpCode(200)
  public simulate(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<GatePass> {
    const scope = this.sites.resolveSiteScope(user, siteId);
    if ("allSites" in scope) {
      throw new BadRequestException("Chọn 1 cơ sở cụ thể trước khi mô phỏng cân + chụp.");
    }
    return this.gatePasses.simulateWeighAndCapture({ scaleId: this.sites.getSite(scope.siteId).scaleId });
  }
}
