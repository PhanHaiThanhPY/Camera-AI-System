import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GatePass as GatePassRow } from "@prisma/client";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
import type {
  AuditEntry,
  Classification,
  GateOverrides,
  GatePass,
  PlateCapture,
  VerificationCheck,
  VerificationStatus,
  VisitStatus,
  WeighSummary
} from "./gate.types";
import type { MasterLink } from "./master.types";

const jsonOrNull = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

function toDomain(row: GatePassRow): GatePass {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    capture: row.capture as unknown as PlateCapture,
    exitCapture: row.exitCapture as unknown as PlateCapture | null,
    vehicleType: row.vehicleType as unknown as Classification,
    material: row.material as unknown as Classification,
    weighing: row.weighing as unknown as WeighSummary | null,
    checks: row.checks as unknown as VerificationCheck[],
    status: row.status as VerificationStatus,
    statusReasons: row.statusReasons as unknown as string[],
    visitStatus: row.visitStatus as VisitStatus,
    resolution: row.resolution as GatePass["resolution"],
    overrides: row.overrides as unknown as GateOverrides,
    effective: row.effective as unknown as GatePass["effective"],
    master: row.master as unknown as MasterLink,
    audit: row.audit as unknown as AuditEntry[]
  };
}

function toRowData(pass: GatePass): Omit<Prisma.GatePassUncheckedCreateInput, "id"> {
  return {
    capturedAt: new Date(pass.capture.capturedAt),
    plateNormalized: pass.capture.plateNormalized,
    status: pass.status,
    visitStatus: pass.visitStatus,
    resolution: pass.resolution,
    capture: pass.capture as unknown as Prisma.InputJsonValue,
    exitCapture: jsonOrNull(pass.exitCapture),
    vehicleType: pass.vehicleType as unknown as Prisma.InputJsonValue,
    material: pass.material as unknown as Prisma.InputJsonValue,
    weighing: jsonOrNull(pass.weighing),
    checks: pass.checks as unknown as Prisma.InputJsonValue,
    statusReasons: pass.statusReasons as unknown as Prisma.InputJsonValue,
    overrides: pass.overrides as unknown as Prisma.InputJsonValue,
    effective: pass.effective as unknown as Prisma.InputJsonValue,
    master: pass.master as unknown as Prisma.InputJsonValue,
    audit: pass.audit as unknown as Prisma.InputJsonValue
  };
}

/**
 * Nguồn dữ liệu duy nhất cho GatePass là Postgres — không còn cache toàn bộ lịch sử trong bộ nhớ.
 * Các hàm ghép (matchScore/secondWeighScore/findOpenPassByPlate) chỉ cần quét tập "đang chờ xử lý"
 * (PENDING), vốn luôn nhỏ (chỉ các lượt xe hiện đang mở), nên truy vấn thẳng DB mỗi lần là đủ nhanh
 * và đúng kiến trúc — không cần tự dựng lại một bộ nhớ đệm không giới hạn như bản file JSON trước đây.
 */
@Injectable()
export class GatePassRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async findById(id: string): Promise<GatePass | null> {
    const row = await this.prisma.gatePass.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /** Toàn bộ lượt đang PENDING — tập hợp nhỏ dùng cho các thuật toán ghép và refreshAll. */
  public async findPending(): Promise<GatePass[]> {
    const rows = await this.prisma.gatePass.findMany({ where: { resolution: "PENDING" } });
    return rows.map(toDomain);
  }

  /** Danh sách lượt xe, mới nhất trước. */
  public async list(options: { limit?: number } = {}): Promise<GatePass[]> {
    const rows = await this.prisma.gatePass.findMany({
      orderBy: { capturedAt: "desc" },
      take: options.limit
    });
    return rows.map(toDomain);
  }

  /** Lượt xe có capturedAt trong [from, to) — dùng cho báo cáo Telegram theo ngày. */
  public async listByCapturedRange(from: Date, to: Date): Promise<GatePass[]> {
    const rows = await this.prisma.gatePass.findMany({
      where: { capturedAt: { gte: from, lt: to } },
      orderBy: { capturedAt: "asc" }
    });
    return rows.map(toDomain);
  }

  public async create(pass: GatePass): Promise<GatePass> {
    const row = await this.prisma.gatePass.create({ data: { id: pass.id, ...toRowData(pass) } });
    return toDomain(row);
  }

  public async save(pass: GatePass): Promise<GatePass> {
    const row = await this.prisma.gatePass.update({ where: { id: pass.id }, data: toRowData(pass) });
    return toDomain(row);
  }

  public async delete(id: string): Promise<void> {
    await this.prisma.gatePass.delete({ where: { id } });
  }

  public async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.gatePass.deleteMany({ where: { id: { in: ids } } });
  }

  public async deleteByResolution(resolutions: GatePass["resolution"][]): Promise<string[]> {
    const targets = await this.prisma.gatePass.findMany({ where: { resolution: { in: resolutions } }, select: { id: true } });
    const ids = targets.map((target) => target.id);
    await this.deleteMany(ids);
    return ids;
  }
}
