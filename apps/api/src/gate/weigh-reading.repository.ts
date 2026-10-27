import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { WeighReading as WeighReadingRow } from "@prisma/client";
import { isDemoMode } from "../config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
import type { WeighReading } from "./gate.types";

function toDomain(row: WeighReadingRow): WeighReading {
  return {
    id: row.id,
    scaleId: row.scaleId,
    ticketNo: row.ticketNo,
    plateNumber: row.plateNumber,
    grossKg: row.grossKg,
    tareKg: row.tareKg,
    measuredAt: row.measuredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    source: row.source as WeighReading["source"],
    gatePassId: row.gatePassId
  };
}

/** DEMO_MODE=true: đọc/ghi bộ nhớ trong (`memory`), không đụng Postgres — xem GatePassRepository. */
@Injectable()
export class WeighReadingRepository {
  private readonly memory = new Map<string, WeighReading>();

  public constructor(private readonly prisma: PrismaService) {}

  public async create(input: Omit<WeighReading, "id" | "receivedAt" | "gatePassId">): Promise<WeighReading> {
    if (isDemoMode()) {
      const reading: WeighReading = {
        id: randomUUID(),
        scaleId: input.scaleId,
        ticketNo: input.ticketNo,
        plateNumber: input.plateNumber,
        grossKg: input.grossKg,
        tareKg: input.tareKg,
        measuredAt: new Date(input.measuredAt).toISOString(),
        receivedAt: new Date().toISOString(),
        source: input.source,
        gatePassId: null
      };
      this.memory.set(reading.id, reading);
      return reading;
    }
    const row = await this.prisma.weighReading.create({
      data: {
        scaleId: input.scaleId,
        ticketNo: input.ticketNo,
        plateNumber: input.plateNumber,
        grossKg: input.grossKg,
        tareKg: input.tareKg,
        measuredAt: new Date(input.measuredAt),
        source: input.source
      }
    });
    return toDomain(row);
  }

  public async findById(id: string): Promise<WeighReading | null> {
    if (isDemoMode()) {
      return this.memory.get(id) ?? null;
    }
    const row = await this.prisma.weighReading.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /** Số liệu cân chưa ghép vào lượt xe nào — tập nhỏ, dùng khi một lượt mới vừa được tạo. */
  public async findUnattached(): Promise<WeighReading[]> {
    if (isDemoMode()) {
      return [...this.memory.values()].filter((reading) => reading.gatePassId === null);
    }
    const rows = await this.prisma.weighReading.findMany({ where: { gatePassId: null } });
    return rows.map(toDomain);
  }

  public async attach(id: string, gatePassId: string): Promise<void> {
    if (isDemoMode()) {
      const reading = this.memory.get(id);
      if (reading !== undefined) {
        this.memory.set(id, { ...reading, gatePassId });
      }
      return;
    }
    await this.prisma.weighReading.update({ where: { id }, data: { gatePassId } });
  }

  public async list(limit = 200): Promise<WeighReading[]> {
    if (isDemoMode()) {
      return [...this.memory.values()].sort((first, second) => second.receivedAt.localeCompare(first.receivedAt)).slice(0, limit);
    }
    const rows = await this.prisma.weighReading.findMany({ orderBy: { receivedAt: "desc" }, take: limit });
    return rows.map(toDomain);
  }

  public async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (isDemoMode()) {
      for (const id of ids) {
        this.memory.delete(id);
      }
      return;
    }
    await this.prisma.weighReading.deleteMany({ where: { id: { in: ids } } });
  }

  public async deleteAll(): Promise<void> {
    if (isDemoMode()) {
      this.memory.clear();
      return;
    }
    await this.prisma.weighReading.deleteMany({});
  }
}
