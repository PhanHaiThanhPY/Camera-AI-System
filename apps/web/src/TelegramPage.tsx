import { FormEvent, ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "./PassDetail";

interface Config {
  configured: boolean;
  hasToken: boolean;
  tokenMasked: string | null;
  botUsername: string | null;
  chatId: string | null;
  chatTitle: string | null;
  timeZone: string;
}

interface Chat {
  id: string;
  title: string;
  type: string;
}

interface Preview {
  total: number;
  messages: string[];
  plainText: string;
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/telegram${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || payload === null) {
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return payload;
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : "Có lỗi xảy ra.");

/** Cài đặt bot Telegram và gửi báo cáo theo ngày vào nhóm. */
export default function TelegramPage(): ReactElement {
  const queryClient = useQueryClient();
  // null = chưa sửa, dùng giá trị đã lưu trên server.
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [chatIdDraft, setChatIdDraft] = useState<string | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [date, setDate] = useState(todayLocal);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const configQuery = useQuery({ queryKey: ["telegram-config"], queryFn: () => api<Config>("/config") });
  const config = configQuery.data;
  const refreshConfig = (value: Config): void => {
    queryClient.setQueryData(["telegram-config"], value);
  };
  const ok = (text: string): void => setNotice({ kind: "ok", text });
  const fail = (error: unknown): void => setNotice({ kind: "error", text: errorText(error) });

  const saveConfig = useMutation({
    mutationFn: async () => {
      const body: { botToken?: string; chatId?: string; chatTitle?: string } = {};
      if (tokenDraft !== null && tokenDraft.trim() !== "") {
        body.botToken = tokenDraft.trim();
      }
      if (chatIdDraft !== null) {
        body.chatId = chatIdDraft.trim();
        body.chatTitle = chatIdDraft.trim() === (config?.chatId ?? "") ? (config?.chatTitle ?? "") : "";
      }
      return api<Config>("/config", "PUT", body);
    },
    onSuccess: (value) => {
      refreshConfig(value);
      setTokenDraft(null);
      setChatIdDraft(null);
      setSavedToken(null);
      setShowToken(false);
      ok(`Đã lưu cấu hình${value.botUsername !== null ? ` (bot @${value.botUsername})` : ""}${value.chatId !== null ? `, nhóm ${value.chatId}` : ""}.`);
    },
    onError: fail
  });
  const reveal = useMutation({
    mutationFn: () => api<{ botToken: string }>("/token/reveal", "POST", {}),
    onSuccess: (value) => {
      setSavedToken(value.botToken);
      setShowToken(true);
    },
    onError: fail
  });
  const findChats = useMutation({
    mutationFn: () => api<Chat[]>("/chats"),
    onSuccess: (list) => {
      setChats(list);
      setNotice(list.length === 0 ? { kind: "error", text: "Chưa thấy nhóm nào. Hãy add bot vào nhóm và gửi một tin nhắn trong nhóm, rồi bấm lại." } : null);
    },
    onError: fail
  });
  const saveChat = useMutation({
    mutationFn: (chat: { id: string; title: string }) => api<Config>("/config", "PUT", { chatId: chat.id, chatTitle: chat.title }),
    onSuccess: (value) => {
      refreshConfig(value);
      setChatIdDraft(null);
      ok(`Đã chọn nhóm "${value.chatTitle ?? value.chatId ?? ""}".`);
    },
    onError: fail
  });
  const test = useMutation({ mutationFn: () => api<{ ok: true }>("/test", "POST", {}), onSuccess: () => ok("Đã gửi tin thử vào nhóm."), onError: fail });
  const clearConfig = useMutation({
    mutationFn: () => api<Config>("/config", "DELETE"),
    onSuccess: (value) => {
      refreshConfig(value);
      setChats(null);
      setTokenDraft(null);
      setChatIdDraft(null);
      setSavedToken(null);
      setShowToken(false);
      ok("Đã xoá cấu hình bot.");
    },
    onError: fail
  });
  const loadPreview = useMutation({
    mutationFn: () => api<Preview>(`/report/preview?date=${date}`),
    onSuccess: (value) => {
      setPreview(value);
      setNotice(null);
    },
    onError: fail
  });
  const sendReport = useMutation({
    mutationFn: () => api<{ total: number; messages: number }>("/report", "POST", { date }),
    onSuccess: (result) => ok(`Đã gửi báo cáo ${result.total} lượt (${result.messages} tin nhắn) vào Telegram.`),
    onError: fail
  });

  const submitConfig = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    saveConfig.mutate();
  };
  const MASK = "••••••••••••••••";
  const hasSavedToken = config?.hasToken === true;
  const tokenValue = tokenDraft ?? (showToken && savedToken !== null ? savedToken : hasSavedToken ? MASK : "");
  const chatIdValue = chatIdDraft ?? config?.chatId ?? "";
  const dirty = (tokenDraft !== null && tokenDraft.trim() !== "") || (chatIdDraft !== null && chatIdDraft.trim() !== (config?.chatId ?? ""));
  const toggleToken = (): void => {
    if (showToken) {
      setShowToken(false);
    } else if (tokenDraft === null && hasSavedToken && savedToken === null) {
      reveal.mutate();
    } else {
      setShowToken(true);
    }
  };
  const editToken = (value: string): void => {
    // Đang hiện dấu chấm che: bỏ dấu chấm, phần gõ mới thay thế token cũ.
    setTokenDraft(tokenDraft === null && !(showToken && savedToken !== null) ? value.replace(/•/g, "") : value);
  };
  const busy = saveConfig.isPending || findChats.isPending || saveChat.isPending || test.isPending || sendReport.isPending;

  return (
    <div className="master-grid">
      <section className="panel captures-page">
        <div className="panel-heading">
          <div><p className="section-kicker">TELEGRAM</p><h2>Cài đặt bot</h2></div>
          <span className={`status-pill ${config?.configured ? "gate-verified" : "gate-review_required"}`}>{config?.configured ? "Đã sẵn sàng" : "Chưa cài xong"}</span>
        </div>

        <ol className="tg-steps">
          <li>Chat với <b>@BotFather</b> → gõ <code>/newbot</code> → copy token.</li>
          <li>Tạo nhóm Telegram, <b>add bot vào nhóm</b>, gửi một tin nhắn bất kỳ trong nhóm.</li>
          <li>Dán token bên dưới, bấm <b>Tìm nhóm</b> và chọn nhóm nhận báo cáo.</li>
        </ol>

        <form className="master-form" onSubmit={submitConfig}>
          <label>Token bot
            <span className="secret-field">
              <input autoComplete="off" placeholder="123456789:AAxxxxxxxx" spellCheck={false} type={showToken ? "text" : "password"} value={tokenValue} onChange={(event) => editToken(event.target.value)} />
              <button aria-label={showToken ? "Ẩn token" : "Hiện token"} aria-pressed={showToken} disabled={reveal.isPending} type="button" onClick={toggleToken}>{showToken ? "Ẩn" : "Hiện"}</button>
            </span>
          </label>
          <label>Chat ID của nhóm
            <input autoComplete="off" placeholder="-1001234567890" spellCheck={false} value={chatIdValue} onChange={(event) => setChatIdDraft(event.target.value)} />
          </label>
          {config?.chatTitle != null && config.chatTitle !== "" && chatIdDraft === null && <p className="muted-text">Nhóm: <b>{config.chatTitle}</b></p>}
          {config?.botUsername != null && <p className="muted-text">Bot đang dùng: <b>@{config.botUsername}</b></p>}
          <div className="gate-actions">
            <button className="primary-button" disabled={!dirty || busy} type="submit">{saveConfig.isPending ? "Đang lưu…" : "Lưu cấu hình"}</button>
            <button className="secondary-button" disabled={!config?.configured || busy || dirty} type="button" onClick={() => test.mutate()}>Gửi tin thử</button>
          </div>
        </form>

        <div className="master-form">
          <strong>Tìm nhóm tự động</strong>
          <p className="muted-text">Add bot vào nhóm, gửi một tin nhắn trong nhóm rồi bấm Tìm nhóm để chọn.</p>
          <div className="gate-actions">
            <button className="secondary-button" disabled={!config?.hasToken || busy} type="button" onClick={() => findChats.mutate()}>{findChats.isPending ? "Đang tìm…" : "Tìm nhóm"}</button>
            <button className="danger-button" disabled={!config?.hasToken || clearConfig.isPending} type="button" onClick={() => window.confirm("Xoá token và nhóm đã cài?") && clearConfig.mutate()}>Xoá cấu hình</button>
          </div>
          {chats !== null && chats.length > 0 && (
            <ul className="tg-chats">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <span><b>{chat.title}</b> <small>{chat.type} · {chat.id}</small></span>
                  <button className="secondary-button" disabled={busy} type="button" onClick={() => saveChat.mutate({ id: chat.id, title: chat.title })}>Chọn</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {notice !== null && <p className={notice.kind === "ok" ? "tg-ok" : "error-message"}>{notice.text}</p>}
      </section>

      <section className="panel captures-page">
        <div className="panel-heading">
          <div><p className="section-kicker">BÁO CÁO</p><h2>Gửi báo cáo vào Telegram</h2></div>
        </div>
        <div className="sheet-filter">
          <label>Chọn ngày<input max={todayLocal()} type="date" value={date} onChange={(event) => { setDate(event.target.value); setPreview(null); }} /></label>
          <button disabled={date === "" || loadPreview.isPending} type="button" onClick={() => loadPreview.mutate()}>Xem trước</button>
          <button className="tg-send" disabled={date === "" || !config?.configured || busy} type="button" onClick={() => sendReport.mutate()}>{sendReport.isPending ? "Đang gửi…" : "Gửi báo cáo vào Telegram"}</button>
        </div>
        {!config?.configured && <p className="muted-text">Cần cài xong token và chọn nhóm ở bên trái trước khi gửi.</p>}
        <p className="muted-text">Múi giờ báo cáo: {config?.timeZone ?? "…"}.</p>
        {preview !== null && (
          <>
            <p className="muted-text">{preview.total} lượt · {preview.messages.length} tin nhắn</p>
            <pre className="tg-preview">{preview.plainText}</pre>
          </>
        )}
      </section>
    </div>
  );
}
