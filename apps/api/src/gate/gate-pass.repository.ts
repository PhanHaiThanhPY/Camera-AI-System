import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GatePass as GatePassRow } from "@prisma/client";
import { isDemoMode } from "../config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
import type {
  AuditEntry,
  CaptureAttempt,
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
    siteId: row.siteId,
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
    audit: row.audit as unknown as AuditEntry[],
    captureState: row.captureState as GatePass["captureState"],
    captureAttempts: row.captureAttempts as unknown as CaptureAttempt[]
  };
}

function toRowData(pass: GatePass): Omit<Prisma.GatePassUncheckedCreateInput, "id"> {
  return {
    siteId: pass.siteId,
    capturedAt: new Date(pass.capture.capturedAt),
    plateNormalized: pass.capture.plateNormalized,
    status: pass.status,
    visitStatus: pass.visitStatus,
    resolution: pass.resolution,
    captureState: pass.captureState,
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
    audit: pass.audit as unknown as Prisma.InputJsonValue,
    captureAttempts: pass.captureAttempts as unknown as Prisma.InputJsonValue
  };
}

/**
 * Nguồn dữ liệu duy nhất cho GatePass là Postgres — không còn cache toàn bộ lịch sử trong bộ nhớ.
 * Các hàm ghép (matchScore/secondWeighScore/findOpenPassByPlate) chỉ cần quét tập "đang chờ xử lý"
 * (PENDING), vốn luôn nhỏ (chỉ các lượt xe hiện đang mở), nên truy vấn thẳng DB mỗi lần là đủ nhanh
 * và đúng kiến trúc — không cần tự dựng lại một bộ nhớ đệm không giới hạn như bản file JSON trước đây.
 *
 * DEMO_MODE=true: không đụng Postgres — toàn bộ đọc/ghi nằm trong `memory`, nạp từ gate/demo-data.ts
 * qua DemoSeedService (xem file đó). Giữ đúng hành vi của từng hàm phía trên để GatePassesService không
 * cần biết đang chạy ở chế độ nào.
 */
@Injectable()
export class GatePassRepository {
  private readonly memory = new Map<string, GatePass>();

  public constructor(private readonly prisma: PrismaService) {}

  public async findById(id: string): Promise<GatePass | null> {
    if (isDemoMode()) {
      return this.memory.get(id) ?? null;
    }
    const row = await this.prisma.gatePass.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /** Toàn bộ lượt đang PENDING của 1 site (hoặc mọi site nếu không truyền — chỉ dùng nội bộ cho
   *  refreshAllPending, không bao giờ lộ ra ngoài qua API) — tập hợp nhỏ dùng cho các thuật toán ghép. */
  public async findPending(siteId?: string): Promise<GatePass[]> {
    if (isDemoMode()) {
      return [...this.memory.values()].filter((pass) => pass.resolution === "PENDING" && (siteId === undefined || pass.siteId === siteId));
    }
    const rows = await this.prisma.gatePass.findMany({ where: { resolution: "PENDING", ...(siteId === undefined ? {} : { siteId }) } });
    return rows.map(toDomain);
  }

  /** Danh sách lượt xe, mới nhất trước. siteId=undefined (chỉ admin) = mọi site. */
  public async list(options: { limit?: number; siteId?: string } = {}): Promise<GatePass[]> {
    if (isDemoMode()) {
      const filtered = [...this.memory.values()].filter((pass) => options.siteId === undefined || pass.siteId === options.siteId);
      const sorted = filtered.sort((first, second) => second.capture.capturedAt.localeCompare(first.capture.capturedAt));
      return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
    }
    const rows = await this.prisma.gatePass.findMany({
      where: options.siteId === undefined ? {} : { siteId: options.siteId },
      orderBy: { capturedAt: "desc" },
      take: options.limit
    });
    return rows.map(toDomain);
  }

  /** Lượt xe có capturedAt trong [from, to) — dùng cho báo cáo Telegram theo ngày. */
  public async listByCapturedRange(from: Date, to: Date): Promise<GatePass[]> {
    if (isDemoMode()) {
      return [...this.memory.values()]
        .filter((pass) => {
          const capturedAt = Date.parse(pass.capture.capturedAt);
          return capturedAt >= from.getTime() && capturedAt < to.getTime();
        })
        .sort((first, second) => first.capture.capturedAt.localeCompare(second.capture.capturedAt));
    }
    const rows = await this.prisma.gatePass.findMany({
      where: { capturedAt: { gte: from, lt: to } },
      orderBy: { capturedAt: "asc" }
    });
    return rows.map(toDomain);
  }

  public async create(pass: GatePass): Promise<GatePass> {
    if (isDemoMode()) {
      return this.saveInMemory(pass);
    }
    const row = await this.prisma.gatePass.create({ data: { id: pass.id, ...toRowData(pass) } });
    return toDomain(row);
  }

  public async save(pass: GatePass): Promise<GatePass> {
    if (isDemoMode()) {
      return this.saveInMemory(pass);
    }
    const row = await this.prisma.gatePass.update({ where: { id: pass.id }, data: toRowData(pass) });
    return toDomain(row);
  }

  public async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      this.memory.delete(id);
      return;
    }
    await this.prisma.gatePass.delete({ where: { id } });
  }

  public async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (isDemoMode()) {
      for (const id of ids) {
        this.memory.delete(id);
      }
      return;
    }
    await this.prisma.gatePass.deleteMany({ where: { id: { in: ids } } });
  }

  public async deleteByResolution(resolutions: GatePass["resolution"][]): Promise<string[]> {
    if (isDemoMode()) {
      const ids = [...this.memory.values()].filter((pass) => resolutions.includes(pass.resolution)).map((pass) => pass.id);
      await this.deleteMany(ids);
      return ids;
    }
    const targets = await this.prisma.gatePass.findMany({ where: { resolution: { in: resolutions } }, select: { id: true } });
    const ids = targets.map((target) => target.id);
    await this.deleteMany(ids);
    return ids;
  }

  private saveInMemory(pass: GatePass): GatePass {
    const now = new Date().toISOString();
    const saved: GatePass = { ...pass, createdAt: this.memory.get(pass.id)?.createdAt ?? now, updatedAt: now };
    this.memory.set(saved.id, saved);
    return saved;
  }
}
