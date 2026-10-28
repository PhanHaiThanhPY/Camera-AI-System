import { BadRequestException, Body, Controller, Get, Post, Res } from "@nestjs/common";
import type { Response } from "express";
// NestJS needs the runtime class token for constructor dependency injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from "../users/users.service";
import type { SafeUser } from "../users/user.types";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from "./auth.service";
import { COOKIE_NAME } from "./auth.constants";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";

type JsonBody = Record<string, unknown> | undefined;

function credentials(body: JsonBody): { email: string; password: string } {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Body phải là JSON object.");
  }
  const email = body.email;
  const password = body.password;
  if (typeof email !== "string" || typeof password !== "string" || email.trim() === "" || password === "") {
    throw new BadRequestException("email và password là bắt buộc.");
  }
  return { email, password };
}

@Controller("auth")
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService
  ) {}

  @Public()
  @Post("login")
  public async login(@Body() body: JsonBody, @Res({ passthrough: true }) res: Response): Promise<SafeUser> {
    const { email, password } = credentials(body);
    const user = await this.users.validateCredentials(email, password);
    const token = this.auth.issueToken(user);
    res.cookie(COOKIE_NAME, token, this.auth.cookieOptions());
    return user;
  }

  @Public()
  @Post("logout")
  public logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  public me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }
}
