import { isDemoMode } from "./demo-mode";

/** DEMO_MODE=true không bắt buộc JWT_SECRET (để demo nhanh không cần cấu hình gì thêm). */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret !== undefined && secret !== "") {
    return secret;
  }
  if (isDemoMode()) {
    return "demo-mode-insecure-secret-do-not-use-in-production";
  }
  throw new Error("JWT_SECRET chưa được cấu hình. Xem .env.example.");
}

export function authTokenTtlDays(): number {
  const raw = process.env.AUTH_TOKEN_TTL_DAYS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}
