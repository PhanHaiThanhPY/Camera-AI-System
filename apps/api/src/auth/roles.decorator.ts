import { SetMetadata } from "@nestjs/common";
import type { Role } from "../users/user.types";

export const ROLES_KEY = "requiredRole";

/** Chỉ role này mới vào được route/controller (vd @Roles("ADMIN") cho trang quản lý tài khoản). */
export const Roles = (role: Role): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, role);
