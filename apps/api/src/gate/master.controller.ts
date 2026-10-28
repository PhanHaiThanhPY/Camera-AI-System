import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "../sites/sites.service";
import type { SafeUser } from "../users/user.types";
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

/** Master data: danh sách xe trong bãi và tài xế theo từng xe — dùng chung mọi Site của 1 account
 *  (`?siteId=` chỉ cần khi gọi với tư cách ADMIN, để biết đang xem account nào). */
@Controller("master")
export class MasterController {
  public constructor(
    private readonly master: MasterDataService,
    private readonly gatePasses: GatePassesService,
    private readonly sites: SitesService
  ) {}

  @Get("vehicles")
  public listVehicles(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): (Vehicle & { drivers: Driver[] })[] {
    return this.master.listVehicles(this.sites.resolveOwnerId(user, siteId));
  }

  @Post("vehicles")
  public createVehicle(@Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<Vehicle> {
    return this.master.createVehicle(this.sites.resolveOwnerId(user, siteId), parseVehicle(body));
  }

  /** Nhập các biển số đã chụp (chưa có trong danh sách) làm xe của master data — trong đúng Site đang chọn. */
  @Post("vehicles/import-captured")
  @HttpCode(200)
  public async importCaptured(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<{ created: number; skipped: number }> {
    const ownerId = this.sites.resolveOwnerId(user, siteId);
    const site = siteId !== undefined ? this.sites.getSite(siteId) : this.sites.listForOwner(ownerId)[0];
    if (site === undefined) {
      return { created: 0, skipped: 0 };
    }
    const seen = new Set<string>();
    const passes = await this.gatePasses.listPasses({ siteId: site.id });
    const plates = passes
      .map((pass) => ({ plateNumber: pass.effective.plateNumber, vehicleType: pass.effective.vehicleType }))
      .filter((item) => !seen.has(item.plateNumber) && seen.add(item.plateNumber));
    return this.master.importPlates(ownerId, plates);
  }

  @Patch("vehicles/:id")
  public updateVehicle(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<Vehicle> {
    return this.master.updateVehicle(this.sites.resolveOwnerId(user, siteId), id, parseVehicle(body));
  }

  @Delete("vehicles/:id")
  public deleteVehicle(@Param("id") id: string, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<{ unlinkedDrivers: number }> {
    return this.master.deleteVehicle(this.sites.resolveOwnerId(user, siteId), id);
  }

  /** Thêm tài xế mới gắn ngay vào xe này. Sửa/xoá tài xế (dù đang gắn xe nào) nằm ở DriversController (/api/drivers). */
  @Post("vehicles/:id/drivers")
  public createDriver(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<Driver> {
    return this.master.createDriver(this.sites.resolveOwnerId(user, siteId), id, parseDriver(body));
  }
}
