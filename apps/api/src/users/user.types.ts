export type Role = "ADMIN" | "USER";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** Hình dạng trả ra ngoài — không bao giờ lộ passwordHash. */
export type SafeUser = Omit<User, "passwordHash">;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  void passwordHash;
  return safe;
}
