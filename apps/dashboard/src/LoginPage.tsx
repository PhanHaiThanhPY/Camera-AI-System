import { FormEvent, ReactElement, useState } from "react";
import { useAuth } from "./AuthContext";

/** Màn đăng nhập — toàn màn hình, tách khỏi .app-shell (chưa có sidebar lúc chưa đăng nhập). */
export default function LoginPage(): ReactElement {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="panel login-card" onSubmit={onSubmit}>
        <p className="login-title">VP HOLDING</p>
        <p className="login-subtitle">ĐIỀU HÀNH CÂN XE</p>
        <label>Email<input autoFocus required autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Mật khẩu<input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error !== null && <p className="login-error">{error}</p>}
        <button className="primary-button" disabled={pending} type="submit">{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      </form>
    </main>
  );
}
