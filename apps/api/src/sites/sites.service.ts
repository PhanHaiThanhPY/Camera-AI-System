import { randomBytes, randomUUID } from "node:crypto";
import type { OnModuleInit } from "@nestjs/common";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { isDemoMode } from "../config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from "../users/users.service";
import type { SafeUser } from "../users/user.types";
import type { Site, SiteCamera, SiteScope } from "./site.types";

export interface CameraInput {
  label?: string;
  rtspUrl?: string;
}

export interface SiteUpdateInput {
  name?: string;
  /** Trạm cân/middleware của hãng cân thường có sẵn ID/key riêng — cho phép đổi để khớp đúng cấu hình
   *  thật của họ, không bắt họ phải đổi theo giá trị hệ thống tự sinh. */
  scaleId?: string;
  weighbridgeApiKey?: string;
}

function randomCode(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/**
 * Giống MasterDataService/UsersService: cache đầy đủ trong bộ nhớ, nạp 1 lần lúc khởi động, ghi-qua
 * ở mọi thao tác sửa. `scaleId`/`cameraId` phải DUY NHẤT TOÀN CỤC (không theo site/account) vì các
 * endpoint @Public() (python/detect, trạm cân ngoài) chỉ gửi đúng 1 chuỗi đó, không gửi kèm site nào
 * — resolveByScaleId/resolveByCameraId là cách duy nhất API tự suy ra site từ request công khai.
 */
@Injectable()
export class SitesService implements OnModuleInit {
  private readonly logger = new Logger(SitesService.name);
  private readonly sites = new Map<string, Site>();
  private readonly cameras = new Map<string, SiteCamera>();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService
  ) {
    // Tài khoản USER mới (do admin tạo) tự có ngay 1 cơ sở để dùng, không cần thao tác thêm.
    this.users.created.subscribe((user) => {
      if (user.role === "USER") {
        this.createSite(user.id, "Cơ sở 1").catch((error: unknown) => {
          this.logger.error(`Không tự tạo được cơ sở mặc định cho ${user.email}: ${String(error)}`);
        });
      }
    });
  }

  public async onModuleInit(): Promise<void> {
    if (isDemoMode()) {
      // Không seed cố định ở đây — UsersService.seedDemoUsers() phát `created` cho tài khoản demo
      // role USER, subscription ở constructor phía trên tự tạo "Cơ sở 1" giống mode thật.
      this.logger.log("DEMO_MODE=true — cơ sở demo tự tạo qua sự kiện UsersService.created.");
      return;
    }
    const [siteRows, cameraRows] = await Promise.all([this.prisma.site.findMany(), this.prisma.siteCamera.findMany()]);
    for (const row of siteRows) {
      this.sites.set(row.id, toDomainSite(row));
    }
    for (const row of cameraRows) {
      this.cameras.set(row.id, toDomainCamera(row));
    }
    this.logger.log(`Đã nạp ${this.sites.size} cơ sở, ${this.cameras.size} camera.`);
    await this.backfillMissingSites();
  }

  /** Tài khoản USER tạo trước khi có tính năng Site (hoặc lỗi lúc tạo tự động) chưa có cơ sở nào —
   *  tự tạo "Cơ sở 1" cho họ ngay, để không ai bị kẹt không dùng được Trạm cân/Sổ cân. */
  private async backfillMissingSites(): Promise<void> {
    const missing = this.users.list().filter((user) => user.role === "USER" && this.listForOwner(user.id).length === 0);
    for (const user of missing) {
      try {
        const site = await this.createSite(user.id, "Cơ sở 1");
        this.logger.log(`Đã tự tạo cơ sở mặc định cho ${user.email} (chưa có khi tính năng Site ra mắt): ${site.id}`);
      } catch (error: unknown) {
        this.logger.error(`Không tự tạo được cơ sở mặc định cho ${user.email}: ${String(error)}`);
      }
    }
  }

  public listForOwner(ownerId: string): Site[] {
    return [...this.sites.values()].filter((site) => site.ownerId === ownerId).sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  /** Cho admin: mọi cơ sở của mọi đối tác, kèm tên account sở hữu. */
  public listAllWithOwner(): (Site & { ownerName: string; ownerEmail: string })[] {
    return [...this.sites.values()]
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .map((site) => {
        const owner = this.users.findById(site.ownerId);
        return { ...site, ownerName: owner?.name ?? "(đã xoá)", ownerEmail: owner?.email ?? "" };
      });
  }

  public camerasOf(siteId: string): SiteCamera[] {
    return [...this.cameras.values()].filter((camera) => camera.siteId === siteId).sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  /** Chỉ dùng cho DemoSeedService (DEMO_MODE=true, luôn đúng 1 site demo) — không dùng ở API thật. */
  public anySite(): Site | undefined {
    return [...this.sites.values()][0];
  }

  public getSite(id: string): Site {
    const site = this.sites.get(id);
    if (site === undefined) {
      throw new NotFoundException("Không tìm thấy cơ sở.");
    }
    return site;
  }

  /** USER chỉ được đụng cơ sở của chính mình; ADMIN đụng được mọi cơ sở. */
  public assertAccess(site: Site, user: SafeUser): void {
    if (user.role !== "ADMIN" && site.ownerId !== user.id) {
      throw new ForbiddenException("Không có quyền với cơ sở này.");
    }
  }

  /**
   * Suy ra "account nào" cho master data (Vehicle/Driver) hoặc dữ liệu theo site: USER luôn là chính
   * họ (siteId nếu có phải thuộc về họ); ADMIN bắt buộc truyền siteId (dùng để biết đang xem account
   * nào) — không có khái niệm "xem gộp mọi account" cho master data.
   */
  public resolveOwnerId(user: SafeUser, siteId: string | undefined): string {
    if (user.role !== "ADMIN") {
      if (siteId !== undefined) {
        this.assertAccess(this.getSite(siteId), user);
      }
      return user.id;
    }
    if (siteId === undefined || siteId === "") {
      throw new BadRequestException("Admin cần chọn 1 cơ sở (siteId) để xem dữ liệu của đúng đối tác.");
    }
    return this.getSite(siteId).ownerId;
  }

  /**
   * Phạm vi cho GatePass/WeighReading (khác resolveOwnerId — ở đây ADMIN không truyền siteId coi là
   * "xem hết" (allSites), USER không truyền siteId thì tự lấy cơ sở đầu tiên của họ làm mặc định).
   */
  public resolveSiteScope(user: SafeUser, siteId: string | undefined): SiteScope {
    if (user.role === "ADMIN") {
      if (siteId === undefined || siteId === "") {
        return { allSites: true };
      }
      this.getSite(siteId);
      return { siteId };
    }
    if (siteId !== undefined && siteId !== "") {
      this.assertAccess(this.getSite(siteId), user);
      return { siteId };
    }
    const fallback = this.listForOwner(user.id)[0];
    if (fallback === undefined) {
      throw new BadRequestException("Bạn chưa có cơ sở nào — tạo 1 cơ sở trước khi dùng chức năng này.");
    }
    return { siteId: fallback.id };
  }

  public async createSite(ownerId: string, name: string): Promise<Site> {
    const trimmed = name.trim();
    if (trimmed === "") {
      throw new BadRequestException("Tên cơ sở là bắt buộc.");
    }
    const scaleId = this.uniqueScaleId();
    const weighbridgeApiKey = randomBytes(24).toString("hex");
    const now = new Date().toISOString();
    const data = { ownerId, name: trimmed, scaleId, weighbridgeApiKey };
    const site: Site = isDemoMode() ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now } : toDomainSite(await this.prisma.site.create({ data }));
    this.sites.set(site.id, site);
    return site;
  }

  public async updateSite(id: string, input: SiteUpdateInput): Promise<Site> {
    const current = this.getSite(id);
    const data: { name?: string; scaleId?: string; weighbridgeApiKey?: string } = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed === "") {
        throw new BadRequestException("Tên cơ sở là bắt buộc.");
      }
      data.name = trimmed;
    }
    if (input.scaleId !== undefined) {
      const trimmed = input.scaleId.trim();
      if (trimmed === "") {
        throw new BadRequestException("Mã trạm cân không được để trống.");
      }
      const existing = this.resolveByScaleId(trimmed);
      if (existing !== undefined && existing.id !== id) {
        throw new ConflictException(`Mã trạm cân "${trimmed}" đã dùng cho cơ sở khác — đổi sang giá trị khác.`);
      }
      data.scaleId = trimmed;
    }
    if (input.weighbridgeApiKey !== undefined) {
      const trimmed = input.weighbridgeApiKey.trim();
      if (trimmed === "") {
        throw new BadRequestException("API key trạm cân không được để trống.");
      }
      data.weighbridgeApiKey = trimmed;
    }
    const site: Site = isDemoMode()
      ? { ...current, ...data, updatedAt: new Date().toISOString() }
      : toDomainSite(await this.prisma.site.update({ where: { id }, data }));
    this.sites.set(site.id, site);
    return site;
  }

  /** Chặn xoá cơ sở còn lượt cân/phiếu cân — tránh mất lịch sử do cascade delete ở DB. */
  public async deleteSite(id: string): Promise<void> {
    this.getSite(id);
    if (!isDemoMode()) {
      const gatePassCount = await this.prisma.gatePass.count({ where: { siteId: id } });
      if (gatePassCount > 0) {
        throw new ConflictException(`Cơ sở đang có ${gatePassCount} lượt cân — không thể xoá.`);
      }
      await this.prisma.site.delete({ where: { id } });
    }
    for (const camera of this.camerasOf(id)) {
      this.cameras.delete(camera.id);
    }
    this.sites.delete(id);
  }

  public async addCamera(siteId: string, input: CameraInput): Promise<SiteCamera> {
    this.getSite(siteId);
    const cameraId = this.uniqueCameraId();
    const data = { siteId, cameraId, label: input.label?.trim() ?? "", rtspUrl: input.rtspUrl?.trim() ?? "" };
    const now = new Date().toISOString();
    const camera: SiteCamera = isDemoMode()
      ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now }
      : toDomainCamera(await this.prisma.siteCamera.create({ data }));
    this.cameras.set(camera.id, camera);
    return camera;
  }

  public async updateCamera(id: string, input: CameraInput): Promise<SiteCamera> {
    const current = this.getCamera(id);
    const data: { label?: string; rtspUrl?: string } = {};
    if (input.label !== undefined) {
      data.label = input.label.trim();
    }
    if (input.rtspUrl !== undefined) {
      data.rtspUrl = input.rtspUrl.trim();
    }
    const camera: SiteCamera = isDemoMode()
      ? { ...current, ...data, updatedAt: new Date().toISOString() }
      : toDomainCamera(await this.prisma.siteCamera.update({ where: { id }, data }));
    this.cameras.set(camera.id, camera);
    return camera;
  }

  public async removeCamera(id: string): Promise<void> {
    this.getCamera(id);
    if (!isDemoMode()) {
      await this.prisma.siteCamera.delete({ where: { id } });
    }
    this.cameras.delete(id);
  }

  public getCamera(id: string): SiteCamera {
    const camera = this.cameras.get(id);
    if (camera === undefined) {
      throw new NotFoundException("Không tìm thấy camera.");
    }
    return camera;
  }

  /** Cốt lõi cho endpoint công khai (trạm cân ngoài gửi scaleId, không gửi site/account nào khác). */
  public resolveByScaleId(scaleId: string): Site | undefined {
    return [...this.sites.values()].find((site) => site.scaleId === scaleId);
  }

  /** Cốt lõi cho endpoint công khai (pipeline Python gửi cameraId, không gửi site/account nào khác). */
  public resolveByCameraId(cameraId: string): { site: Site; camera: SiteCamera } | undefined {
    const camera = [...this.cameras.values()].find((item) => item.cameraId === cameraId);
    if (camera === undefined) {
      return undefined;
    }
    const site = this.sites.get(camera.siteId);
    return site === undefined ? undefined : { site, camera };
  }

  private uniqueScaleId(): string {
    let candidate = randomCode("SCALE");
    while (this.resolveByScaleId(candidate) !== undefined) {
      candidate = randomCode("SCALE");
    }
    return candidate;
  }

  private uniqueCameraId(): string {
    let candidate = randomCode("cam");
    while (this.resolveByCameraId(candidate) !== undefined) {
      candidate = randomCode("cam");
    }
    return candidate;
  }
}

function toDomainSite(row: { id: string; ownerId: string; name: string; scaleId: string; weighbridgeApiKey: string; createdAt: Date; updatedAt: Date }): Site {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    scaleId: row.scaleId,
    weighbridgeApiKey: row.weighbridgeApiKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDomainCamera(row: { id: string; siteId: string; cameraId: string; label: string; rtspUrl: string; createdAt: Date; updatedAt: Date }): SiteCamera {
  return {
    id: row.id,
    siteId: row.siteId,
    cameraId: row.cameraId,
    label: row.label,
    rtspUrl: row.rtspUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
