import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { CreateUserInput, UpdateUserInput } from "./users.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from "./users.service";
import type { Role, SafeUser } from "./user.types";

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

function role(source: Record<string, unknown>, key: string): Role | undefined {
  const value = text(source, key);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "ADMIN" && value !== "USER") {
    throw new BadRequestException(`${key} phải là ADMIN hoặc USER.`);
  }
  return value;
}

function parseCreate(body: JsonBody): CreateUserInput {
  const source = record(body);
  const email = text(source, "email");
  const password = text(source, "password");
  const name = text(source, "name");
  if (email === undefined || password === undefined || name === undefined) {
    throw new BadRequestException("email, password, name là bắt buộc.");
  }
  return { email, password, name, role: role(source, "role") ?? "USER" };
}

function parseUpdate(body: JsonBody): UpdateUserInput {
  const source = record(body);
  const input: UpdateUserInput = {};
  const email = text(source, "email");
  const name = text(source, "name");
  const password = text(source, "password");
  if (email !== undefined) {
    input.email = email;
  }
  if (name !== undefined) {
    input.name = name;
  }
  if (password !== undefined) {
    input.password = password;
  }
  const parsedRole = role(source, "role");
  if (parsedRole !== undefined) {
    input.role = parsedRole;
  }
  if (source.isActive !== undefined) {
    if (typeof source.isActive !== "boolean") {
      throw new BadRequestException("isActive phải là true/false.");
    }
    input.isActive = source.isActive;
  }
  return input;
}

/** Quản lý tài khoản — chỉ ADMIN. Không có tự đăng ký; admin tạo tài khoản cho nhân viên ở đây. */
@Roles("ADMIN")
@Controller("users")
export class UsersController {
  public constructor(private readonly users: UsersService) {}

  @Get()
  public list(): SafeUser[] {
    return this.users.list();
  }

  @Post()
  public create(@Body() body: JsonBody): Promise<SafeUser> {
    return this.users.create(parseCreate(body));
  }

  @Patch(":id")
  public update(@Param("id") id: string, @Body() body: JsonBody, @CurrentUser() current: SafeUser): Promise<SafeUser> {
    return this.users.update(id, parseUpdate(body), current.id);
  }

  @Delete(":id")
  @HttpCode(200)
  public async remove(@Param("id") id: string, @CurrentUser() current: SafeUser): Promise<{ ok: true }> {
    await this.users.remove(id, current.id);
    return { ok: true };
  }
}
