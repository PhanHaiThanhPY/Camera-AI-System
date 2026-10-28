import { randomUUID } from "node:crypto";
import type { OnModuleInit } from "@nestjs/common";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Subject } from "rxjs";
import { isDemoMode } from "../config/demo-mode";
import { findVehicleProfile } from "./gate.catalog";
import { editDistance, normalizePlate } from "./gate.verification";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
import { DEMO_VEHICLES } from "./demo-data";
import { NO_MASTER_LINK } from "./master.types";
import type { Driver, MasterLink, Vehicle } from "./master.types";

export interface VehicleInput {
  plateNumber?: string;
  vehicleType?: string | null;
  note?: string;
}

export interface DriverInput {
  fullName?: string;
  phone?: string;
  licenseNo?: string;
  note?: string;
  isPrimary?: boolean;
}

/**
 * Postgres là nguồn dữ liệu, nhưng khác GatePass (lịch sử không ngừng lớn lên), danh sách xe trong bãi
 * có kích thước bị chặn tự nhiên (số xe của đội xe thực tế — vài chục đến vài trăm), và `lookup()` cần
 * chạy đồng bộ/nhanh trên MỖI lần refresh một GatePass. Vì vậy service này giữ một bộ nhớ đệm đầy đủ,
 * nạp một lần lúc khởi động và ghi-qua (write-through) ở mọi thao tác sửa — khác hẳn với việc không cache
 * gì (GatePassesService) hay cache không giới hạn kiểu file JSON cũ.
 *
 * Multi-tenant: Vehicle/Driver thuộc về 1 account (`ownerId`), dùng chung giữa mọi Site của account đó.
 * Mọi method public đều nhận `ownerId` và lọc đúng theo account đó — không có "xem chung toàn cục" nữa.
 */
@Injectable()
export class MasterDataService implements OnModuleInit {
  private readonly logger = new Logger(MasterDataService.name);
  private readonly vehicles = new Map<string, Vehicle & { ownerId: string }>();
  private readonly drivers = new Map<string, Driver & { ownerId: string }>();
  /** Phát mỗi khi master data đổi để các lượt quét được đối chiếu lại. */
  public readonly changes = new Subject<void>();

  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    if (isDemoMode()) {
      this.seedDemoMasterData();
      this.logger.log(`DEMO_MODE=true — nạp master data mẫu: ${this.vehicles.size} xe, ${this.drivers.size} tài xế.`);
      return;
    }
    const [vehicles, drivers] = await Promise.all([this.prisma.vehicle.findMany(), this.prisma.driver.findMany()]);
    for (const vehicle of vehicles) {
      this.vehicles.set(vehicle.id, toDomainVehicle(vehicle));
    }
    for (const driver of drivers) {
      this.drivers.set(driver.id, toDomainDriver(driver));
    }
    this.logger.log(`Đã nạp master data: ${this.vehicles.size} xe, ${this.drivers.size} tài xế.`);
  }

  /** Nạp danh sách xe/tài xế mẫu (gate/demo-data.ts) thẳng vào bộ nhớ — không qua Postgres. Gán hết
   *  cho ownerId "demo-owner" cố định (demo mode chỉ có 1 account demo thực sự dùng dữ liệu này). */
  private seedDemoMasterData(): void {
    const ownerId = "demo-owner";
    for (const seed of DEMO_VEHICLES) {
      const now = new Date().toISOString();
      const vehicleId = randomUUID();
      this.vehicles.set(vehicleId, {
        id: vehicleId,
        ownerId,
        plateNumber: seed.plateNumber,
        plateNormalized: normalizePlate(seed.plateNumber),
        vehicleType: seed.vehicleType,
        note: seed.note,
        createdAt: now,
        updatedAt: now
      });
      for (const driverSeed of seed.drivers) {
        const driverId = randomUUID();
        this.drivers.set(driverId, {
          id: driverId,
          ownerId,
          vehicleId,
          fullName: driverSeed.fullName,
          phone: driverSeed.phone,
          licenseNo: driverSeed.licenseNo,
          note: "",
          isPrimary: driverSeed.isPrimary,
          createdAt: now,
          updatedAt: now
        });
      }
    }
  }

  public listVehicles(ownerId: string): (Vehicle & { drivers: Driver[] })[] {
    return [...this.vehicles.values()]
      .filter((vehicle) => vehicle.ownerId === ownerId)
      .sort((first, second) => first.plateNormalized.localeCompare(second.plateNormalized))
      .map((vehicle) => ({ ...vehicle, drivers: this.driversOf(vehicle.id) }));
  }

  /** Chỉ dùng cho trợ lý Telegram (AssistantService) — bot chạy ở mức deployment, không gắn với 1
   *  account cụ thể, nên admin chat với bot cần xem được xe của mọi đối tác (đúng "admin xem được hết"). */
  public listAllVehiclesAcrossOwners(): (Vehicle & { drivers: Driver[] })[] {
    return [...this.vehicles.values()]
      .sort((first, second) => first.plateNormalized.localeCompare(second.plateNormalized))
      .map((vehicle) => ({ ...vehicle, drivers: this.driversOf(vehicle.id) }));
  }

  public async createVehicle(ownerId: string, input: VehicleInput): Promise<Vehicle> {
    const plate = this.validPlate(input.plateNumber);
    this.assertUnique(ownerId, plate.normalized, null);
    const vehicleType = this.validType(input.vehicleType);
    const note = input.note ?? "";
    const now = new Date().toISOString();
    const data = { ownerId, plateNumber: plate.display, plateNormalized: plate.normalized, vehicleType, note };
    const vehicle = isDemoMode() ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now } : toDomainVehicle(await this.prisma.vehicle.create({ data }));
    this.vehicles.set(vehicle.id, vehicle);
    this.changed();
    return vehicle;
  }

  public async updateVehicle(ownerId: string, id: string, input: VehicleInput): Promise<Vehicle> {
    const current = this.getVehicle(ownerId, id);
    const data: { plateNumber?: string; plateNormalized?: string; vehicleType?: string | null; note?: string } = {};
    if (input.plateNumber !== undefined) {
      const plate = this.validPlate(input.plateNumber);
      this.assertUnique(ownerId, plate.normalized, id);
      data.plateNumber = plate.display;
      data.plateNormalized = plate.normalized;
    }
    if (input.vehicleType !== undefined) {
      data.vehicleType = this.validType(input.vehicleType);
    }
    if (input.note !== undefined) {
      data.note = input.note;
    }
    const vehicle = isDemoMode()
      ? { ...current, ...data, updatedAt: new Date().toISOString() }
      : toDomainVehicle(await this.prisma.vehicle.update({ where: { id: current.id }, data }));
    this.vehicles.set(vehicle.id, vehicle);
    this.changed();
    return vehicle;
  }

  /** Xoá xe — tài xế của xe đó không bị xoá, chỉ gỡ liên kết (vehicleId về null; cascade SetNull ở DB). */
  public async deleteVehicle(ownerId: string, id: string): Promise<{ unlinkedDrivers: number }> {
    this.getVehicle(ownerId, id);
    const owned = this.driversOf(id);
    if (!isDemoMode()) {
      await this.prisma.vehicle.delete({ where: { id } });
    }
    for (const driver of owned) {
      this.drivers.set(driver.id, { ...driver, vehicleId: null });
    }
    this.vehicles.delete(id);
    this.changed();
    return { unlinkedDrivers: owned.length };
  }

  public async createDriver(ownerId: string, vehicleId: string, input: DriverInput): Promise<Driver> {
    this.getVehicle(ownerId, vehicleId);
    const fullName = input.fullName?.trim();
    if (fullName === undefined || fullName === "") {
      throw new BadRequestException("Họ tên tài xế là bắt buộc.");
    }
    // Tài xế đầu tiên của xe mặc định là tài xế chính.
    const isPrimary = input.isPrimary ?? this.driversOf(vehicleId).length === 0;
    const data = { ownerId, vehicleId, fullName, phone: input.phone ?? "", licenseNo: input.licenseNo ?? "", note: input.note ?? "", isPrimary };
    const now = new Date().toISOString();
    const driver = isDemoMode()
      ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now }
      : toDomainDriver(await this.prisma.driver.create({ data }));
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary && driver.vehicleId !== null) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  public async updateDriver(ownerId: string, id: string, input: DriverInput): Promise<Driver> {
    const current = this.getDriver(ownerId, id);
    if (input.fullName !== undefined && input.fullName.trim() === "") {
      throw new BadRequestException("Họ tên tài xế là bắt buộc.");
    }
    const data: { fullName?: string; phone?: string; licenseNo?: string; note?: string; isPrimary?: boolean } = {};
    if (input.fullName !== undefined) {
      data.fullName = input.fullName.trim();
    }
    if (input.phone !== undefined) {
      data.phone = input.phone;
    }
    if (input.licenseNo !== undefined) {
      data.licenseNo = input.licenseNo;
    }
    if (input.note !== undefined) {
      data.note = input.note;
    }
    if (input.isPrimary !== undefined) {
      data.isPrimary = input.isPrimary;
    }
    const driver = isDemoMode()
      ? { ...current, ...data, updatedAt: new Date().toISOString() }
      : toDomainDriver(await this.prisma.driver.update({ where: { id: current.id }, data }));
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary && driver.vehicleId !== null) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  /** Danh sách tất cả tài xế của 1 account (master data độc lập), kèm biển số xe đang gắn (nếu có). */
  public listAllDrivers(ownerId: string): (Driver & { plateNumber: string | null })[] {
    return [...this.drivers.values()]
      .filter((driver) => driver.ownerId === ownerId)
      .sort((first, second) => first.fullName.localeCompare(second.fullName))
      .map((driver) => ({
        ...driver,
        plateNumber: driver.vehicleId === null ? null : (this.vehicles.get(driver.vehicleId)?.plateNumber ?? null)
      }));
  }

  /** Tạo tài xế không nhất thiết phải gắn xe ngay (master data "Tài xế" ở sidebar). */
  public async createStandaloneDriver(ownerId: string, input: DriverInput & { vehicleId?: string | null }): Promise<Driver> {
    const fullName = input.fullName?.trim();
    if (fullName === undefined || fullName === "") {
      throw new BadRequestException("Họ tên tài xế là bắt buộc.");
    }
    const vehicleId = this.resolveVehicleId(ownerId, input.vehicleId);
    const isPrimary = vehicleId !== null && (input.isPrimary ?? false);
    const data = { ownerId, vehicleId, fullName, phone: input.phone ?? "", licenseNo: input.licenseNo ?? "", note: input.note ?? "", isPrimary };
    const now = new Date().toISOString();
    const driver = isDemoMode()
      ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now }
      : toDomainDriver(await this.prisma.driver.create({ data }));
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary && vehicleId !== null) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  /** Gắn hoặc gỡ xe cho một tài xế đã có (độc lập với việc sửa thông tin cá nhân). */
  public async updateDriverVehicle(ownerId: string, id: string, vehicleIdInput: string | null | undefined): Promise<Driver> {
    const current = this.getDriver(ownerId, id);
    const vehicleId = this.resolveVehicleId(ownerId, vehicleIdInput);
    const isPrimary = vehicleId === null ? false : current.isPrimary;
    const driver = isDemoMode()
      ? { ...current, vehicleId, isPrimary, updatedAt: new Date().toISOString() }
      : toDomainDriver(await this.prisma.driver.update({ where: { id: current.id }, data: { vehicleId, isPrimary } }));
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary && vehicleId !== null) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  public async deleteDriver(ownerId: string, id: string): Promise<void> {
    const driver = this.getDriver(ownerId, id);
    if (!isDemoMode()) {
      await this.prisma.driver.delete({ where: { id } });
    }
    this.drivers.delete(id);
    // Xoá tài xế chính (của 1 xe) thì chuyển vai trò cho người còn lại đầu tiên của xe đó.
    if (driver.vehicleId !== null) {
      const rest = this.driversOf(driver.vehicleId);
      const successor = rest[0];
      if (driver.isPrimary && successor !== undefined) {
        if (!isDemoMode()) {
          await this.prisma.driver.update({ where: { id: successor.id }, data: { isPrimary: true } });
        }
        this.drivers.set(successor.id, { ...successor, isPrimary: true });
      }
    }
    this.changed();
  }

  /** undefined = không đổi (chỉ dùng ở createStandaloneDriver, luôn resolve); "" | null = gỡ liên kết;
   *  id hợp lệ = gắn xe đó (phải cùng ownerId, không cho gắn xe của account khác). */
  private resolveVehicleId(ownerId: string, value: string | null | undefined): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    this.getVehicle(ownerId, value);
    return value;
  }

  /** Thêm xe từ danh sách biển số quét được; bỏ qua biển đã có (trong account này). */
  public async importPlates(ownerId: string, plates: { plateNumber: string; vehicleType: string | null }[]): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const item of plates) {
      const normalized = normalizePlate(item.plateNumber);
      if (normalized.length < 4 || this.findByNormalized(ownerId, normalized) !== undefined) {
        skipped += 1;
        continue;
      }
      const data = {
        ownerId,
        plateNumber: item.plateNumber.trim(),
        plateNormalized: normalized,
        vehicleType: item.vehicleType !== null && findVehicleProfile(item.vehicleType) !== undefined ? item.vehicleType : null,
        note: "Nhập từ danh sách ảnh đã chụp"
      };
      const now = new Date().toISOString();
      const vehicle = isDemoMode() ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now } : toDomainVehicle(await this.prisma.vehicle.create({ data }));
      this.vehicles.set(vehicle.id, vehicle);
      created += 1;
    }
    if (created > 0) {
      this.changed();
    }
    return { created, skipped };
  }

  /** Khớp chính xác theo biển chuẩn hoá; lệch 1 ký tự coi là "gần giống" (thường do OCR đọc nhầm).
   *  Chỉ khớp trong master data của đúng account sở hữu Site đang xử lý lượt xe đó. */
  public lookup(ownerId: string, plate: string): MasterLink {
    const normalized = normalizePlate(plate);
    const exact = this.findByNormalized(ownerId, normalized);
    if (exact !== undefined) {
      return this.link("exact", exact);
    }
    let nearest: Vehicle | undefined;
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.ownerId === ownerId && editDistance(normalized, vehicle.plateNormalized) <= 1 && normalized.length >= 5) {
        nearest = vehicle;
        break;
      }
    }
    return nearest === undefined ? NO_MASTER_LINK : this.link("near", nearest);
  }

  private link(match: "exact" | "near", vehicle: Vehicle): MasterLink {
    return {
      match,
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      drivers: this.driversOf(vehicle.id).map(({ id, fullName, phone, isPrimary }) => ({ id, fullName, phone, isPrimary }))
    };
  }

  private driversOf(vehicleId: string | null): Driver[] {
    return [...this.drivers.values()]
      .filter((driver) => driver.vehicleId === vehicleId)
      .sort((first, second) => Number(second.isPrimary) - Number(first.isPrimary) || first.createdAt.localeCompare(second.createdAt));
  }

  private async demoteOthers(keep: Driver): Promise<void> {
    const others = this.driversOf(keep.vehicleId).filter((driver) => driver.id !== keep.id && driver.isPrimary);
    for (const other of others) {
      if (!isDemoMode()) {
        await this.prisma.driver.update({ where: { id: other.id }, data: { isPrimary: false } });
      }
      this.drivers.set(other.id, { ...other, isPrimary: false });
    }
  }

  private getVehicle(ownerId: string, id: string): Vehicle & { ownerId: string } {
    const vehicle = this.vehicles.get(id);
    if (vehicle === undefined || vehicle.ownerId !== ownerId) {
      throw new NotFoundException("Không tìm thấy xe.");
    }
    return vehicle;
  }

  private getDriver(ownerId: string, id: string): Driver & { ownerId: string } {
    const driver = this.drivers.get(id);
    if (driver === undefined || driver.ownerId !== ownerId) {
      throw new NotFoundException("Không tìm thấy tài xế.");
    }
    return driver;
  }

  private findByNormalized(ownerId: string, normalized: string): Vehicle | undefined {
    return [...this.vehicles.values()].find((vehicle) => vehicle.ownerId === ownerId && vehicle.plateNormalized === normalized);
  }

  private validPlate(value: string | undefined): { display: string; normalized: string } {
    const display = value?.trim() ?? "";
    const normalized = normalizePlate(display);
    if (normalized.length < 4) {
      throw new BadRequestException("Biển số không hợp lệ.");
    }
    return { display, normalized };
  }

  private validType(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (findVehicleProfile(value) === undefined) {
      throw new BadRequestException("Loại xe không có trong danh mục.");
    }
    return value;
  }

  private assertUnique(ownerId: string, normalized: string, exceptId: string | null): void {
    const existing = this.findByNormalized(ownerId, normalized);
    if (existing !== undefined && existing.id !== exceptId) {
      throw new ConflictException(`Biển số ${existing.plateNumber} đã có trong danh sách xe.`);
    }
  }

  private changed(): void {
    this.changes.next();
  }
}

function toDomainVehicle(row: {
  id: string;
  ownerId: string;
  plateNumber: string;
  plateNormalized: string;
  vehicleType: string | null;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}): Vehicle & { ownerId: string } {
  return {
    id: row.id,
    ownerId: row.ownerId,
    plateNumber: row.plateNumber,
    plateNormalized: row.plateNormalized,
    vehicleType: row.vehicleType,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDomainDriver(row: {
  id: string;
  ownerId: string;
  vehicleId: string | null;
  fullName: string;
  phone: string;
  licenseNo: string;
  note: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Driver & { ownerId: string } {
  return {
    id: row.id,
    ownerId: row.ownerId,
    vehicleId: row.vehicleId,
    fullName: row.fullName,
    phone: row.phone,
    licenseNo: row.licenseNo,
    note: row.note,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
