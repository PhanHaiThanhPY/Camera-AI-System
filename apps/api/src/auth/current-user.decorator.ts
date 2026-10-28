import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { SafeUser } from "../users/user.types";

/** Người dùng hiện tại, đã được AuthGuard gắn vào request. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SafeUser => {
  const request = context.switchToHttp().getRequest<Request & { user: SafeUser }>();
  return request.user;
});
