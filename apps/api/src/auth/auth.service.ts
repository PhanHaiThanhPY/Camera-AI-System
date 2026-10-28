import { Injectable } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtService } from "@nestjs/jwt";
import type { CookieOptions } from "express";
import { authTokenTtlDays } from "../config/jwt-secret";
import type { SafeUser } from "../users/user.types";
import type { JwtPayload } from "./auth.guard";

@Injectable()
export class AuthService {
  public constructor(private readonly jwt: JwtService) {}

  public issueToken(user: SafeUser): string {
    const payload: JwtPayload = { sub: user.id };
    return this.jwt.sign(payload);
  }

  public cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: authTokenTtlDays() * 24 * 60 * 60 * 1000,
      path: "/"
    };
  }
}
