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
 */
@Injectable()
export class MasterDataService implements OnModuleInit {
  private readonly logger = new Logger(MasterDataService.name);
  private readonly vehicles = new Map<string, Vehicle>();
  private readonly drivers = new Map<string, Driver>();
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

  /** Nạp danh sách xe/tài xế mẫu (gate/demo-data.ts) thẳng vào bộ nhớ — không qua Postgres. */
  private seedDemoMasterData(): void {
    for (const seed of DEMO_VEHICLES) {
      const now = new Date().toISOString();
      const vehicleId = randomUUID();
      this.vehicles.set(vehicleId, {
        id: vehicleId,
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

  public listVehicles(): (Vehicle & { drivers: Driver[] })[] {
    return [...this.vehicles.values()]
      .sort((first, second) => first.plateNormalized.localeCompare(second.plateNormalized))
      .map((vehicle) => ({ ...vehicle, drivers: this.driversOf(vehicle.id) }));
  }

  public async createVehicle(input: VehicleInput): Promise<Vehicle> {
    const plate = this.validPlate(input.plateNumber);
    this.assertUnique(plate.normalized, null);
    const vehicleType = this.validType(input.vehicleType);
    const note = input.note ?? "";
    const now = new Date().toISOString();
    const vehicle = isDemoMode()
      ? { id: randomUUID(), plateNumber: plate.display, plateNormalized: plate.normalized, vehicleType, note, createdAt: now, updatedAt: now }
      : toDomainVehicle(
          await this.prisma.vehicle.create({ data: { plateNumber: plate.display, plateNormalized: plate.normalized, vehicleType, note } })
        );
    this.vehicles.set(vehicle.id, vehicle);
    this.changed();
    return vehicle;
  }

  public async updateVehicle(id: string, input: VehicleInput): Promise<Vehicle> {
    const current = this.getVehicle(id);
    const data: { plateNumber?: string; plateNormalized?: string; vehicleType?: string | null; note?: string } = {};
    if (input.plateNumber !== undefined) {
      const plate = this.validPlate(input.plateNumber);
      this.assertUnique(plate.normalized, id);
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

  /** Xoá xe kèm toàn bộ tài xế của xe đó (cascade ở DB). */
  public async deleteVehicle(id: string): Promise<{ removedDrivers: number }> {
    this.getVehicle(id);
    const owned = this.driversOf(id);
    if (!isDemoMode()) {
      await this.prisma.vehicle.delete({ where: { id } });
    }
    for (const driver of owned) {
      this.drivers.delete(driver.id);
    }
    this.vehicles.delete(id);
    this.changed();
    return { removedDrivers: owned.length };
  }

  public async createDriver(vehicleId: string, input: DriverInput): Promise<Driver> {
    this.getVehicle(vehicleId);
    const fullName = input.fullName?.trim();
    if (fullName === undefined || fullName === "") {
      throw new BadRequestException("Họ tên tài xế là bắt buộc.");
    }
    // Tài xế đầu tiên của xe mặc định là tài xế chính.
    const isPrimary = input.isPrimary ?? this.driversOf(vehicleId).length === 0;
    const data = { vehicleId, fullName, phone: input.phone ?? "", licenseNo: input.licenseNo ?? "", note: input.note ?? "", isPrimary };
    const now = new Date().toISOString();
    const driver = isDemoMode()
      ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now }
      : toDomainDriver(await this.prisma.driver.create({ data }));
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  public async updateDriver(id: string, input: DriverInput): Promise<Driver> {
    const current = this.getDriver(id);
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
    if (driver.isPrimary) {
      await this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  public async deleteDriver(id: string): Promise<void> {
    const driver = this.getDriver(id);
    if (!isDemoMode()) {
      await this.prisma.driver.delete({ where: { id } });
    }
    this.drivers.delete(id);
    // Xoá tài xế chính thì chuyển vai trò cho người còn lại đầu tiên.
    const rest = this.driversOf(driver.vehicleId);
    const successor = rest[0];
    if (driver.isPrimary && successor !== undefined) {
      if (!isDemoMode()) {
        await this.prisma.driver.update({ where: { id: successor.id }, data: { isPrimary: true } });
      }
      this.drivers.set(successor.id, { ...successor, isPrimary: true });
    }
    this.changed();
  }

  /** Thêm xe từ danh sách biển số quét được; bỏ qua biển đã có. */
  public async importPlates(plates: { plateNumber: string; vehicleType: string | null }[]): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const item of plates) {
      const normalized = normalizePlate(item.plateNumber);
      if (normalized.length < 4 || this.findByNormalized(normalized) !== undefined) {
        skipped += 1;
        continue;
      }
      const data = {
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

  /** Khớp chính xác theo biển chuẩn hoá; lệch 1 ký tự coi là "gần giống" (thường do OCR đọc nhầm). */
  public lookup(plate: string): MasterLink {
    const normalized = normalizePlate(plate);
    const exact = this.findByNormalized(normalized);
    if (exact !== undefined) {
      return this.link("exact", exact);
    }
    let nearest: Vehicle | undefined;
    for (const vehicle of this.vehicles.values()) {
      if (editDistance(normalized, vehicle.plateNormalized) <= 1 && normalized.length >= 5) {
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

  private driversOf(vehicleId: string): Driver[] {
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

  private getVehicle(id: string): Vehicle {
    const vehicle = this.vehicles.get(id);
    if (vehicle === undefined) {
      throw new NotFoundException("Không tìm thấy xe.");
    }
    return vehicle;
  }

  private getDriver(id: string): Driver {
    const driver = this.drivers.get(id);
    if (driver === undefined) {
      throw new NotFoundException("Không tìm thấy tài xế.");
    }
    return driver;
  }

  private findByNormalized(normalized: string): Vehicle | undefined {
    return [...this.vehicles.values()].find((vehicle) => vehicle.plateNormalized === normalized);
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

  private assertUnique(normalized: string, exceptId: string | null): void {
    const existing = this.findByNormalized(normalized);
    if (existing !== undefined && existing.id !== exceptId) {
      throw new ConflictException(`Biển số ${existing.plateNumber} đã có trong danh sách xe.`);
    }
  }

  private changed(): void {
    this.changes.next();
  }
}

function toDomainVehicle(row: { id: string; plateNumber: string; plateNormalized: string; vehicleType: string | null; note: string; createdAt: Date; updatedAt: Date }): Vehicle {
  return {
    id: row.id,
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
  vehicleId: string;
  fullName: string;
  phone: string;
  licenseNo: string;
  note: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Driver {
  return {
    id: row.id,
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
