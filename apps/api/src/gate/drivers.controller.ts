import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SitesService } from "../sites/sites.service";
import type { SafeUser } from "../users/user.types";
import type { Driver } from "./master.types";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MasterDataService } from "./master-data.service";
import type { DriverInput } from "./master-data.service";

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

function parseVehicleId(source: Record<string, unknown>): string | null | undefined {
  if (!("vehicleId" in source)) {
    return undefined;
  }
  const value = source.vehicleId;
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException("vehicleId phải là chuỗi hoặc null.");
  }
  return value;
}

function parseDriver(body: JsonBody): DriverInput & { vehicleId?: string | null } {
  const source = record(body);
  const input: DriverInput & { vehicleId?: string | null } = {};
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
  const vehicleId = parseVehicleId(source);
  if (vehicleId !== undefined) {
    input.vehicleId = vehicleId;
  }
  return input;
}

/** Master data "Tài xế" — độc lập với xe, dùng chung mọi Site của 1 account (`?siteId=` chỉ cần khi
 *  gọi với tư cách ADMIN, để biết đang xem account nào). */
@Controller("drivers")
export class DriversController {
  public constructor(
    private readonly master: MasterDataService,
    private readonly sites: SitesService
  ) {}

  @Get()
  public listDrivers(@CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): (Driver & { plateNumber: string | null })[] {
    return this.master.listAllDrivers(this.sites.resolveOwnerId(user, siteId));
  }

  @Post()
  public createDriver(@Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<Driver> {
    return this.master.createStandaloneDriver(this.sites.resolveOwnerId(user, siteId), parseDriver(body));
  }

  @Patch(":id")
  public async updateDriver(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<Driver> {
    const ownerId = this.sites.resolveOwnerId(user, siteId);
    const { vehicleId, ...input } = parseDriver(body);
    let driver = await this.master.updateDriver(ownerId, id, input);
    if (vehicleId !== undefined) {
      driver = await this.master.updateDriverVehicle(ownerId, id, vehicleId);
    }
    return driver;
  }

  @Delete(":id")
  @HttpCode(200)
  public async deleteDriver(@Param("id") id: string, @CurrentUser() user: SafeUser, @Query("siteId") siteId?: string): Promise<{ ok: true }> {
    await this.master.deleteDriver(this.sites.resolveOwnerId(user, siteId), id);
    return { ok: true };
  }
}
