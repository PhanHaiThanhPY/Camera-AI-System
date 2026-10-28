import { ReactElement, ReactNode, createContext, useContext, useEffect, useState } from "react";
import type { AuthUser } from "./auth";
import { fetchMe, login as loginRequest, logout as logoutRequest, onUnauthorized } from "./auth";
import type { Site } from "./sites";
import { listSites } from "./sites";

type Status = "loading" | "unauthenticated" | "authenticated";

const CURRENT_SITE_STORAGE_KEY = "camera-ai:current-site";

function readStoredSiteId(): string | null {
  try {
    return localStorage.getItem(CURRENT_SITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSiteId(siteId: string | null): void {
  try {
    if (siteId === null) {
      localStorage.removeItem(CURRENT_SITE_STORAGE_KEY);
    } else {
      localStorage.setItem(CURRENT_SITE_STORAGE_KEY, siteId);
    }
  } catch {
    // Chỉ là tiện ích nhớ lựa chọn — lỗi thì bỏ qua, không ảnh hưởng chức năng.
  }
}

interface AuthState {
  status: Status;
  user: AuthUser | null;
  sites: Site[];
  /** null = chưa chọn được gì (ADMIN có thể cố ý xem "Tất cả cơ sở"). */
  currentSiteId: string | null;
  setCurrentSiteId: (siteId: string | null) => void;
  refreshSites: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Bọc toàn bộ app: tự hỏi /auth/me + /sites lúc mở trang, và tự chuyển về màn đăng nhập khi cookie hết hạn. */
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [currentSiteId, setCurrentSiteIdState] = useState<string | null>(readStoredSiteId);

  const setCurrentSiteId = (siteId: string | null): void => {
    setCurrentSiteIdState(siteId);
    storeSiteId(siteId);
  };

  const loadSites = async (forUser: AuthUser): Promise<void> => {
    const list = await listSites().catch(() => []);
    setSites(list);
    const stored = readStoredSiteId();
    const stillValid = stored !== null && (forUser.role === "ADMIN" || list.some((site) => site.id === stored));
    if (stillValid) {
      setCurrentSiteIdState(stored);
    } else if (forUser.role !== "ADMIN" && list.length > 0) {
      setCurrentSiteId(list[0].id);
    } else {
      setCurrentSiteId(null);
    }
  };

  useEffect(() => {
    const unsubscribe = onUnauthorized(() => {
      setUser(null);
      setSites([]);
      setStatus("unauthenticated");
    });
    fetchMe()
      .then(async (me) => {
        setUser(me);
        await loadSites(me);
        setStatus("authenticated");
      })
      .catch(() => {
        setUser(null);
        setStatus("unauthenticated");
      });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const me = await loginRequest(email, password);
    setUser(me);
    await loadSites(me);
    setStatus("authenticated");
  };

  const logout = async (): Promise<void> => {
    await logoutRequest().catch(() => undefined);
    setUser(null);
    setSites([]);
    setStatus("unauthenticated");
  };

  const refreshSites = async (): Promise<void> => {
    if (user !== null) {
      await loadSites(user);
    }
  };

  return (
    <AuthContext.Provider value={{ status, user, sites, currentSiteId, setCurrentSiteId, refreshSites, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth phải được dùng trong AuthProvider.");
  }
  return ctx;
}
