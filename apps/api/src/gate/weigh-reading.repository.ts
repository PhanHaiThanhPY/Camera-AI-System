import { Injectable } from "@nestjs/common";
import type { WeighReading as WeighReadingRow } from "@prisma/client";
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

@Injectable()
export class WeighReadingRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(input: Omit<WeighReading, "id" | "receivedAt" | "gatePassId">): Promise<WeighReading> {
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
    const row = await this.prisma.weighReading.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /** Số liệu cân chưa ghép vào lượt xe nào — tập nhỏ, dùng khi một lượt mới vừa được tạo. */
  public async findUnattached(): Promise<WeighReading[]> {
    const rows = await this.prisma.weighReading.findMany({ where: { gatePassId: null } });
    return rows.map(toDomain);
  }

  public async attach(id: string, gatePassId: string): Promise<void> {
    await this.prisma.weighReading.update({ where: { id }, data: { gatePassId } });
  }

  public async list(limit = 200): Promise<WeighReading[]> {
    const rows = await this.prisma.weighReading.findMany({ orderBy: { receivedAt: "desc" }, take: limit });
    return rows.map(toDomain);
  }

  public async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.weighReading.deleteMany({ where: { id: { in: ids } } });
  }

  public async deleteAll(): Promise<void> {
    await this.prisma.weighReading.deleteMany({});
  }
}
