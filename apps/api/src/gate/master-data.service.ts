import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Subject } from "rxjs";
import { findVehicleProfile } from "./gate.catalog";
import { editDistance, normalizePlate } from "./gate.verification";
import { JsonStore } from "./json-store";
import { NO_MASTER_LINK } from "./master.types";
import type { Driver, MasterLink, Vehicle } from "./master.types";

const storageRoot = process.env.STORAGE_ROOT ?? join(process.cwd(), "../../storage");

interface MasterState {
  vehicles: Vehicle[];
  drivers: Driver[];
}

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

@Injectable()
export class MasterDataService {
  private readonly store = new JsonStore<MasterState>(join(storageRoot, "master-data.json"));
  private readonly vehicles = new Map<string, Vehicle>();
  private readonly drivers = new Map<string, Driver>();
  /** Phát mỗi khi master data đổi để các lượt quét được đối chiếu lại. */
  public readonly changes = new Subject<void>();

  public constructor() {
    const state = this.store.load();
    for (const vehicle of state?.vehicles ?? []) {
      this.vehicles.set(vehicle.id, vehicle);
    }
    for (const driver of state?.drivers ?? []) {
      this.drivers.set(driver.id, driver);
    }
  }

  public listVehicles(): (Vehicle & { drivers: Driver[] })[] {
    return [...this.vehicles.values()]
      .sort((first, second) => first.plateNormalized.localeCompare(second.plateNormalized))
      .map((vehicle) => ({ ...vehicle, drivers: this.driversOf(vehicle.id) }));
  }

  public createVehicle(input: VehicleInput): Vehicle {
    const plate = this.validPlate(input.plateNumber);
    this.assertUnique(plate.normalized, null);
    const now = new Date().toISOString();
    const vehicle: Vehicle = {
      id: randomUUID(),
      plateNumber: plate.display,
      plateNormalized: plate.normalized,
      vehicleType: this.validType(input.vehicleType),
      note: input.note ?? "",
      createdAt: now,
      updatedAt: now
    };
    this.vehicles.set(vehicle.id, vehicle);
    this.changed();
    return vehicle;
  }

  public updateVehicle(id: string, input: VehicleInput): Vehicle {
    const vehicle = this.getVehicle(id);
    if (input.plateNumber !== undefined) {
      const plate = this.validPlate(input.plateNumber);
      this.assertUnique(plate.normalized, id);
      vehicle.plateNumber = plate.display;
      vehicle.plateNormalized = plate.normalized;
    }
    if (input.vehicleType !== undefined) {
      vehicle.vehicleType = this.validType(input.vehicleType);
    }
    if (input.note !== undefined) {
      vehicle.note = input.note;
    }
    vehicle.updatedAt = new Date().toISOString();
    this.changed();
    return vehicle;
  }

  /** Xoá xe kèm toàn bộ tài xế của xe đó. */
  public deleteVehicle(id: string): { removedDrivers: number } {
    this.getVehicle(id);
    const owned = this.driversOf(id);
    for (const driver of owned) {
      this.drivers.delete(driver.id);
    }
    this.vehicles.delete(id);
    this.changed();
    return { removedDrivers: owned.length };
  }

  public createDriver(vehicleId: string, input: DriverInput): Driver {
    this.getVehicle(vehicleId);
    const fullName = input.fullName?.trim();
    if (fullName === undefined || fullName === "") {
      throw new BadRequestException("Họ tên tài xế là bắt buộc.");
    }
    const now = new Date().toISOString();
    const driver: Driver = {
      id: randomUUID(),
      vehicleId,
      fullName,
      phone: input.phone ?? "",
      licenseNo: input.licenseNo ?? "",
      note: input.note ?? "",
      // Tài xế đầu tiên của xe mặc định là tài xế chính.
      isPrimary: input.isPrimary ?? this.driversOf(vehicleId).length === 0,
      createdAt: now,
      updatedAt: now
    };
    this.drivers.set(driver.id, driver);
    if (driver.isPrimary) {
      this.demoteOthers(driver);
    }
    this.changed();
    return driver;
  }

  public updateDriver(id: string, input: DriverInput): Driver {
    const driver = this.getDriver(id);
    if (input.fullName !== undefined) {
      if (input.fullName.trim() === "") {
        throw new BadRequestException("Họ tên tài xế là bắt buộc.");
      }
      driver.fullName = input.fullName.trim();
    }
    driver.phone = input.phone ?? driver.phone;
    driver.licenseNo = input.licenseNo ?? driver.licenseNo;
    driver.note = input.note ?? driver.note;
    if (input.isPrimary !== undefined) {
      driver.isPrimary = input.isPrimary;
      if (driver.isPrimary) {
        this.demoteOthers(driver);
      }
    }
    driver.updatedAt = new Date().toISOString();
    this.changed();
    return driver;
  }

  public deleteDriver(id: string): void {
    const driver = this.getDriver(id);
    this.drivers.delete(id);
    // Xoá tài xế chính thì chuyển vai trò cho người còn lại đầu tiên.
    const rest = this.driversOf(driver.vehicleId);
    if (driver.isPrimary && rest[0] !== undefined) {
      rest[0].isPrimary = true;
    }
    this.changed();
  }

  /** Thêm xe từ danh sách biển số quét được; bỏ qua biển đã có. */
  public importPlates(plates: { plateNumber: string; vehicleType: string | null }[]): { created: number; skipped: number } {
    let created = 0;
    let skipped = 0;
    for (const item of plates) {
      const normalized = normalizePlate(item.plateNumber);
      if (normalized.length < 4 || this.findByNormalized(normalized) !== undefined) {
        skipped += 1;
        continue;
      }
      const now = new Date().toISOString();
      const vehicle: Vehicle = {
        id: randomUUID(),
        plateNumber: item.plateNumber.trim(),
        plateNormalized: normalized,
        vehicleType: item.vehicleType !== null && findVehicleProfile(item.vehicleType) !== undefined ? item.vehicleType : null,
        note: "Nhập từ danh sách ảnh đã chụp",
        createdAt: now,
        updatedAt: now
      };
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

  private demoteOthers(keep: Driver): void {
    for (const other of this.driversOf(keep.vehicleId)) {
      if (other.id !== keep.id) {
        other.isPrimary = false;
      }
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
    this.store.save(() => ({ vehicles: [...this.vehicles.values()], drivers: [...this.drivers.values()] }));
    this.changes.next();
  }
}
