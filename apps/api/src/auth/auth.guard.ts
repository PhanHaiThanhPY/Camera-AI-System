import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from "../users/users.service";
import type { SafeUser } from "../users/user.types";
import { COOKIE_NAME } from "./auth.constants";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ROLES_KEY } from "./roles.decorator";

export interface JwtPayload {
  sub: string;
}

/**
 * Bảo vệ MỌI route theo mặc định (đăng ký global qua APP_GUARD trong AuthModule) — route nào không cần
 * đăng nhập phải tự đánh dấu @Public(). Xác thực cookie + đúng role (@Roles) trong cùng 1 guard cho gọn,
 * tra người dùng từ cache của UsersService (không query DB mỗi request) nên tài khoản vừa bị khoá có hiệu
 * lực ngay ở request kế tiếp.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: SafeUser }>();
    const token = (request.cookies as Record<string, string | undefined> | undefined)?.[COOKIE_NAME];
    if (token === undefined || token === "") {
      throw new UnauthorizedException("Chưa đăng nhập.");
    }
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    }
    const user = this.users.findActiveById(payload.sub);
    if (user === undefined) {
      throw new UnauthorizedException("Tài khoản không còn hiệu lực.");
    }
    request.user = user;

    const requiredRole = this.reflector.getAllAndOverride<string>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (requiredRole !== undefined && user.role !== requiredRole) {
      throw new ForbiddenException("Không có quyền truy cập.");
    }
    return true;
  }
}
