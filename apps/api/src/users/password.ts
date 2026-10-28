import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/** Tách riêng 1 file để sau muốn đổi lib hash (vd bcryptjs -> argon2) chỉ sửa ở đây. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
