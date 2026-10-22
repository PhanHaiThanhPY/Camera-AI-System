import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import type { Driver, Vehicle } from "./master.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GatePassesService } from "./gate-passes.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MasterDataService } from "./master-data.service";
import type { DriverInput, VehicleInput } from "./master-data.service";

type JsonBody = Record<string, unknown> | undefined;

function record(body: JsonBody): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Body phải là JSON object.");
  }
  return body;
}

function text(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} phải là chuỗi.`);
  }
  return value.trim();
}

function parseVehicle(body: JsonBody): VehicleInput {
  const source = record(body);
  const input: VehicleInput = {};
  const plateNumber = text(source, "plateNumber");
  const note = text(source, "note");
  if (plateNumber !== undefined) {
    input.plateNumber = plateNumber;
  }
  if (note !== undefined) {
    input.note = note;
  }
  if (source.vehicleType !== undefined) {
    input.vehicleType = source.vehicleType === null ? null : (text(source, "vehicleType") ?? null);
  }
  return input;
}

function parseDriver(body: JsonBody): DriverInput {
  const source = record(body);
  const input: DriverInput = {};
  for (const key of ["fullName", "phone", "licenseNo", "note"] as const) {
    const value = text(source, key);
    if (value !== undefined) {
      input[key] = value;
    }
  }
  if (source.isPrimary !== undefined) {
    if (typeof source.isPrimary !== "boolean") {
      throw new BadRequestException("isPrimary phải là true/false.");
    }
    input.isPrimary = source.isPrimary;
  }
  return input;
}

/** Master data: danh sách xe trong bãi và tài xế theo từng xe. */
@Controller("master")
export class MasterController {
  public constructor(
    private readonly master: MasterDataService,
    private readonly gatePasses: GatePassesService
  ) {}

  @Get("vehicles")
  public listVehicles(): (Vehicle & { drivers: Driver[] })[] {
    return this.master.listVehicles();
  }

  @Post("vehicles")
  public createVehicle(@Body() body: JsonBody): Vehicle {
    return this.master.createVehicle(parseVehicle(body));
  }

  /** Nhập các biển số đã chụp (chưa có trong danh sách) làm xe của master data. */
  @Post("vehicles/import-captured")
  @HttpCode(200)
  public importCaptured(): { created: number; skipped: number } {
    const seen = new Set<string>();
    const plates = this.gatePasses
      .listPasses()
      .map((pass) => ({ plateNumber: pass.effective.plateNumber, vehicleType: pass.effective.vehicleType }))
      .filter((item) => !seen.has(item.plateNumber) && seen.add(item.plateNumber));
    return this.master.importPlates(plates);
  }

  @Patch("vehicles/:id")
  public updateVehicle(@Param("id") id: string, @Body() body: JsonBody): Vehicle {
    return this.master.updateVehicle(id, parseVehicle(body));
  }

  @Delete("vehicles/:id")
  public deleteVehicle(@Param("id") id: string): { removedDrivers: number } {
    return this.master.deleteVehicle(id);
  }

  @Post("vehicles/:id/drivers")
  public createDriver(@Param("id") id: string, @Body() body: JsonBody): Driver {
    return this.master.createDriver(id, parseDriver(body));
  }

  @Patch("drivers/:id")
  public updateDriver(@Param("id") id: string, @Body() body: JsonBody): Driver {
    return this.master.updateDriver(id, parseDriver(body));
  }

  @Delete("drivers/:id")
  @HttpCode(200)
  public deleteDriver(@Param("id") id: string): { ok: true } {
    this.master.deleteDriver(id);
    return { ok: true };
  }
}
