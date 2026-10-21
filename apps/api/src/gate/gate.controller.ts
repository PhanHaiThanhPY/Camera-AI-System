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
  Query
} from "@nestjs/common";
import { MATERIALS, VEHICLE_PROFILES } from "./gate.catalog";
import type { GateOverrides, GatePass, WeighReading } from "./gate.types";
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
  return {
    scaleId: optionalString(record, "scaleId") ?? "SCALE-01",
    ticketNo: optionalString(record, "ticketNo"),
    plateNumber: optionalString(record, "plateNumber"),
    grossKg,
    tareKg,
    measuredAt: new Date(measuredAt).toISOString()
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
  public constructor(private readonly gatePasses: GatePassesService) {}

  @Get("catalog")
  public catalog(): { vehicleTypes: { code: string; label: string }[]; materials: { code: string; label: string }[] } {
    return {
      vehicleTypes: VEHICLE_PROFILES.map(({ code, label }) => ({ code, label })),
      materials: MATERIALS
    };
  }

  @Get("passes")
  public listPasses(@Query("videoJobId") videoJobId: string | undefined): GatePass[] {
    const passes = this.gatePasses.listPasses();
    return videoJobId === undefined ? passes : passes.filter((pass) => pass.capture.videoJobId === videoJobId);
  }

  @Get("captures")
  public captures(): ReturnType<GatePassesService["listCaptures"]> {
    return this.gatePasses.listCaptures();
  }

  /** Dọn dung lượng: scope=resolved (mặc định) chỉ xoá lượt đã xác nhận/từ chối; scope=all xoá cả lượt đang chờ. */
  @Delete("passes")
  public clear(@Query("scope") scope: string | undefined): { removed: number; freedBytes: number } {
    if (scope !== undefined && scope !== "resolved" && scope !== "all") {
      throw new BadRequestException("scope phải là resolved hoặc all.");
    }
    return this.gatePasses.clear(scope ?? "resolved");
  }

  @Delete("passes/:id")
  public remove(@Param("id") id: string): { removed: number; freedBytes: number } {
    return this.gatePasses.remove(id);
  }

  @Get("passes/:id")
  public getPass(@Param("id") id: string): GatePass {
    return this.gatePasses.getPass(id);
  }

  @Post("passes/:id/confirm")
  @HttpCode(200)
  public confirm(@Param("id") id: string, @Body() body: JsonBody): GatePass {
    return this.gatePasses.resolve(id, "CONFIRMED", parseResolve(body));
  }

  @Post("passes/:id/reject")
  @HttpCode(200)
  public reject(@Param("id") id: string, @Body() body: JsonBody): GatePass {
    return this.gatePasses.resolve(id, "REJECTED", parseResolve(body));
  }

  @Post("passes/:id/link-reading")
  @HttpCode(200)
  public linkReading(@Param("id") id: string, @Body() body: JsonBody): GatePass {
    const record = asRecord(body);
    const readingId = optionalString(record, "readingId");
    if (readingId === null) {
      throw new BadRequestException("readingId là bắt buộc.");
    }
    return this.gatePasses.linkReading(id, readingId, optionalString(record, "actor") ?? "operator", optionalString(record, "reason"));
  }

  @Get("readings")
  public listReadings(): WeighReading[] {
    return this.gatePasses.listReadings();
  }

  /** Hệ thống cân bên ngoài đẩy số liệu về đây. Đặt WEIGHBRIDGE_API_KEY để yêu cầu header X-Weighbridge-Key. */
  @Post("weighbridge/readings")
  @HttpCode(201)
  public ingest(@Headers("x-weighbridge-key") key: string | undefined, @Body() body: JsonBody): WeighReading {
    const expected = process.env.WEIGHBRIDGE_API_KEY;
    if (expected !== undefined && expected !== "" && key !== expected) {
      throw new ForbiddenException("API key trạm cân không hợp lệ.");
    }
    return this.gatePasses.ingestReading(parseReading(body));
  }
}
