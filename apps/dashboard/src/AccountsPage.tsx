import { FormEvent, ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "./PassDetail";

type Role = "ADMIN" | "USER";

interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/users${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

const EMPTY_FORM = { email: "", name: "", password: "", role: "USER" as Role, isActive: true };

/** Quản lý tài khoản — chỉ admin vào được (App.tsx chặn route, server cũng chặn qua @Roles("ADMIN")). */
export default function AccountsPage(): ReactElement {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<(typeof EMPTY_FORM & { id?: string }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("") });
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  const onError = (error: unknown): void => setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.");

  const saveAccount = useMutation({
    mutationFn: (value: NonNullable<typeof form>) => {
      const { id, ...rest } = value;
      const body: Record<string, unknown> = { email: rest.email, name: rest.name, role: rest.role, isActive: rest.isActive };
      if (rest.password !== "") {
        body.password = rest.password;
      }
      return id === undefined ? api<Account>("", "POST", body) : api<Account>(`/${id}`, "PATCH", body);
    },
    onSuccess: () => {
      setForm(null);
      setMessage(null);
      refresh();
    },
    onError
  });
  const removeAccount = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/${id}`, "DELETE"),
    onSuccess: refresh,
    onError
  });
  const toggleActive = useMutation({
    mutationFn: (account: Account) => api<Account>(`/${account.id}`, "PATCH", { isActive: !account.isActive }),
    onSuccess: refresh,
    onError
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (form !== null) {
      saveAccount.mutate(form);
    }
  };

  const openEdit = (account: Account): void => {
    setForm({ id: account.id, email: account.email, name: account.name, password: "", role: account.role, isActive: account.isActive });
  };

  return (
    <section className="panel captures-page">
      <div className="panel-heading">
        <div><p className="section-kicker">QUẢN TRỊ</p><h2>Tài khoản đăng nhập</h2></div>
        <span className="count-badge">{accountsQuery.data?.length ?? 0} tài khoản</span>
      </div>
      <div className="master-toolbar">
        <button className="primary-button" type="button" onClick={() => setForm({ ...EMPTY_FORM })}>Thêm tài khoản</button>
      </div>
      {message !== null && <p className="muted-text">{message}</p>}

      {form !== null && (
        <form className="master-form" onSubmit={submit}>
          <strong>{form.id === undefined ? "Thêm tài khoản" : "Sửa tài khoản"}</strong>
          <div className="master-form-grid">
            <label>Họ tên<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          </div>
          <div className="master-form-grid">
            <label>{form.id === undefined ? "Mật khẩu" : "Mật khẩu mới (để trống nếu không đổi)"}
              <input required={form.id === undefined} minLength={6} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </label>
            <label>Vai trò
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                <option value="USER">Nhân viên</option>
                <option value="ADMIN">Quản trị viên</option>
              </select>
            </label>
          </div>
          <div className="gate-actions">
            <button className="primary-button" disabled={saveAccount.isPending} type="submit">Lưu</button>
            <button className="secondary-button" type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}

      <div className="sheet-wrap">
        <table className="sheet compact">
          <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th /></tr></thead>
          <tbody>
            {(accountsQuery.data ?? []).length === 0 && <tr><td className="cell-empty" colSpan={6}>Chưa có tài khoản nào khác.</td></tr>}
            {(accountsQuery.data ?? []).map((account) => (
              <tr key={account.id}>
                <td>{account.name}{account.id === currentUser?.id && <span className="muted-text"> (bạn)</span>}</td>
                <td className="cell-nowrap">{account.email}</td>
                <td><span className={`status-pill ${account.role === "ADMIN" ? "gate-verified" : "gate-waiting_capture"}`}>{account.role === "ADMIN" ? "Quản trị viên" : "Nhân viên"}</span></td>
                <td><span className={`status-pill ${account.isActive ? "gate-verified" : "gate-mismatch"}`}>{account.isActive ? "Hoạt động" : "Đã khoá"}</span></td>
                <td className="cell-nowrap">{account.lastLoginAt === null ? "Chưa đăng nhập" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(account.lastLoginAt))}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" onClick={() => openEdit(account)}>Sửa</button>
                    {account.id !== currentUser?.id && (
                      <>
                        <button type="button" onClick={() => toggleActive.mutate(account)}>{account.isActive ? "Khoá" : "Mở lại"}</button>
                        <button className="danger" type="button" onClick={() => window.confirm(`Xoá tài khoản ${account.name}?`) && removeAccount.mutate(account.id)}>Xoá</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
