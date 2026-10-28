const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export type Role = "ADMIN" | "USER";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** AuthContext đăng ký nghe sự kiện này để tự chuyển về màn đăng nhập khi cookie hết hạn/bị gỡ. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const listener of listeners) {
    listener();
  }
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/auth${path}`, { ...init, credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

export const fetchMe = (): Promise<AuthUser> => authFetch<AuthUser>("/me");

export const login = (email: string, password: string): Promise<AuthUser> =>
  authFetch<AuthUser>("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });

export const logout = (): Promise<{ ok: true }> => authFetch<{ ok: true }>("/logout", { method: "POST" });
