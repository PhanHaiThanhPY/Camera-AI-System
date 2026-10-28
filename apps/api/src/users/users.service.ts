import { randomUUID } from "node:crypto";
import type { OnModuleInit } from "@nestjs/common";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Subject } from "rxjs";
import { isDemoMode } from "../config/demo-mode";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword, verifyPassword } from "./password";
import type { Role, SafeUser, User } from "./user.types";
import { toSafeUser } from "./user.types";

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Giống MasterDataService: Postgres là nguồn dữ liệu nhưng số tài khoản nhỏ (vài chục nhân viên), nên giữ
 * cache đầy đủ trong bộ nhớ, nạp 1 lần lúc khởi động, ghi-qua ở mọi thao tác sửa. AuthGuard tra cứu đồng bộ
 * từ cache này ở MỖI request (không query DB mỗi lần) nhưng vẫn phát hiện ngay tài khoản bị khoá/xoá vì
 * cache luôn được ghi-qua trước khi trả response.
 */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  private readonly users = new Map<string, User>();
  /** SitesModule nghe sự kiện này để tự tạo "Cơ sở 1" khi có tài khoản USER mới — tránh phụ thuộc
   *  chéo module (Sites phụ thuộc Users, không phải ngược lại). */
  public readonly created = new Subject<SafeUser>();

  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    if (isDemoMode()) {
      await this.seedDemoUsers();
      this.logger.log(`DEMO_MODE=true — nạp ${this.users.size} tài khoản mẫu.`);
      return;
    }
    const rows = await this.prisma.user.findMany();
    for (const row of rows) {
      this.users.set(row.id, toDomainUser(row));
    }
    this.logger.log(`Đã nạp ${this.users.size} tài khoản.`);
    await this.bootstrapAdminIfEmpty();
  }

  /** Lần đầu chạy ở mode thật (chưa ai trong bảng User): tự tạo 1 admin từ ADMIN_EMAIL/ADMIN_PASSWORD. */
  private async bootstrapAdminIfEmpty(): Promise<void> {
    if (this.users.size > 0) {
      return;
    }
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (email === undefined || email === "" || password === undefined || password === "") {
      this.logger.warn("Chưa có tài khoản nào và thiếu ADMIN_EMAIL/ADMIN_PASSWORD — không tự tạo được admin.");
      return;
    }
    const name = process.env.ADMIN_NAME?.trim() !== "" ? process.env.ADMIN_NAME! : "Quản trị viên";
    const passwordHash = await hashPassword(password);
    const row = await this.prisma.user.create({ data: { email, passwordHash, name, role: "ADMIN", isActive: true } });
    this.users.set(row.id, toDomainUser(row));
    this.logger.log(`Đã tạo tài khoản admin đầu tiên: ${email} (đổi mật khẩu sau khi đăng nhập lần đầu).`);
  }

  private async seedDemoUsers(): Promise<void> {
    const now = new Date().toISOString();
    const seeds: { email: string; password: string; name: string; role: Role }[] = [
      { email: "admin@demo.local", password: "demo123", name: "Admin Demo", role: "ADMIN" },
      { email: "user@demo.local", password: "demo123", name: "Nhân viên Demo", role: "USER" }
    ];
    for (const seed of seeds) {
      const id = randomUUID();
      const user: User = {
        id,
        email: seed.email,
        passwordHash: await hashPassword(seed.password),
        name: seed.name,
        role: seed.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null
      };
      this.users.set(id, user);
      this.created.next(toSafeUser(user));
    }
  }

  /** Dùng ở AuthGuard — tra cứu đồng bộ, không query DB mỗi request. */
  public findActiveById(id: string): SafeUser | undefined {
    const user = this.users.get(id);
    return user !== undefined && user.isActive ? toSafeUser(user) : undefined;
  }

  /** Không lọc isActive — dùng để hiện tên account (vd admin xem danh sách Site của mọi đối tác). */
  public findById(id: string): SafeUser | undefined {
    const user = this.users.get(id);
    return user === undefined ? undefined : toSafeUser(user);
  }

  public async validateCredentials(email: string, password: string): Promise<SafeUser> {
    const normalized = email.trim().toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.email === normalized);
    if (user === undefined || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }
    const updated: User = { ...user, lastLoginAt: new Date().toISOString() };
    if (!isDemoMode()) {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(updated.lastLoginAt!) } });
    }
    this.users.set(user.id, updated);
    return toSafeUser(updated);
  }

  public list(): SafeUser[] {
    return [...this.users.values()].sort((first, second) => first.name.localeCompare(second.name)).map(toSafeUser);
  }

  public async create(input: CreateUserInput): Promise<SafeUser> {
    const email = this.validEmail(input.email);
    this.assertEmailUnique(email, null);
    const name = input.name.trim();
    if (name === "") {
      throw new BadRequestException("Tên là bắt buộc.");
    }
    this.validPassword(input.password);
    const passwordHash = await hashPassword(input.password);
    const now = new Date().toISOString();
    const data = { email, passwordHash, name, role: input.role, isActive: true };
    const user: User = isDemoMode()
      ? { id: randomUUID(), ...data, createdAt: now, updatedAt: now, lastLoginAt: null }
      : toDomainUser(await this.prisma.user.create({ data }));
    this.users.set(user.id, user);
    const safe = toSafeUser(user);
    this.created.next(safe);
    return safe;
  }

  public async update(id: string, input: UpdateUserInput, currentUserId: string): Promise<SafeUser> {
    const current = this.getUser(id);
    const data: { email?: string; name?: string; role?: Role; isActive?: boolean; passwordHash?: string } = {};
    if (input.email !== undefined) {
      const email = this.validEmail(input.email);
      this.assertEmailUnique(email, id);
      data.email = email;
    }
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name === "") {
        throw new BadRequestException("Tên là bắt buộc.");
      }
      data.name = name;
    }
    if (input.role !== undefined) {
      if (id === currentUserId && input.role !== "ADMIN") {
        throw new BadRequestException("Không thể tự hạ quyền của chính mình.");
      }
      data.role = input.role;
    }
    if (input.isActive !== undefined) {
      if (id === currentUserId && !input.isActive) {
        throw new BadRequestException("Không thể tự khoá tài khoản của chính mình.");
      }
      data.isActive = input.isActive;
    }
    if (input.password !== undefined && input.password !== "") {
      this.validPassword(input.password);
      data.passwordHash = await hashPassword(input.password);
    }
    const user: User = isDemoMode()
      ? { ...current, ...data, updatedAt: new Date().toISOString() }
      : toDomainUser(await this.prisma.user.update({ where: { id: current.id }, data }));
    this.users.set(user.id, user);
    return toSafeUser(user);
  }

  public async remove(id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) {
      throw new BadRequestException("Không thể tự xoá tài khoản của chính mình.");
    }
    this.getUser(id);
    if (!isDemoMode()) {
      await this.prisma.user.delete({ where: { id } });
    }
    this.users.delete(id);
  }

  private getUser(id: string): User {
    const user = this.users.get(id);
    if (user === undefined) {
      throw new NotFoundException("Không tìm thấy tài khoản.");
    }
    return user;
  }

  private validEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException("Email không hợp lệ.");
    }
    return email;
  }

  private validPassword(value: string): void {
    if (value.length < 6) {
      throw new BadRequestException("Mật khẩu phải có ít nhất 6 ký tự.");
    }
  }

  private assertEmailUnique(email: string, exceptId: string | null): void {
    const existing = [...this.users.values()].find((candidate) => candidate.email === email);
    if (existing !== undefined && existing.id !== exceptId) {
      throw new ConflictException(`Email ${email} đã được dùng.`);
    }
  }
}

function toDomainUser(row: {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    role: row.role as Role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString()
  };
}
