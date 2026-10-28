import { ReactElement } from "react";
import App from "./App";
import { useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";

/** Chặn toàn bộ dashboard: chưa đăng nhập (hoặc đang hỏi /auth/me) thì không render <App/>. */
export default function AuthGate(): ReactElement {
  const { status } = useAuth();
  if (status === "loading") {
    return <div className="login-shell" />;
  }
  if (status === "unauthenticated") {
    return <LoginPage />;
  }
  return <App />;
}
