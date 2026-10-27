import { ReactElement, useEffect, useState } from "react";
import ConfirmPage from "./ConfirmPage";
import CapturesTable from "./CapturesTable";
import LivePage from "./LivePage";
import OpsPage from "./OpsPage";
import PassPage from "./PassPage";
import { useGateCatalog, useGateFeed } from "./PassDetail";

type View = "live" | "confirm" | "table" | "ops";
const VIEWS: View[] = ["live", "confirm", "table", "ops"];
/** Bốn mục chuẩn theo sơ đồ sidebar trong proposal (trang 08–11). Bot Telegram chỉ cấu hình qua biến môi
 *  trường (TELEGRAM_BOT_TOKEN/DEEPSEEK_API_KEY) trên máy chủ API, không có trang cài đặt riêng ở dashboard. */
const NAV_ITEMS: { view: View; num: string; label: string }[] = [
  { view: "live", num: "01", label: "Trạm cân trực tiếp" },
  { view: "confirm", num: "02", label: "Xác nhận vật liệu" },
  { view: "table", num: "03", label: "Sổ cân & truy vết" },
  { view: "ops", num: "04", label: "Điều hành ba cơ sở" }
];
const VIEW_TITLES: Record<View, { title: string; subtitle: string }> = {
  live: { title: "Trạm cân trực tiếp", subtitle: "" },
  confirm: { title: "Nhận đúng nhóm hàng, kiểm soát riêng từng cấp đá", subtitle: "" },
  table: { title: "Sổ cân & truy vết", subtitle: "" },
  ops: { title: "Điều hành ba cơ sở", subtitle: "" }
};
/** Route theo hash (#/live, #/table, #/pass/<id>) nên chạy được trên mọi static host. */
function readRoute(): { view: View; passId: string | null } {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter((part) => part !== "");
  if (parts[0] === "pass" && parts[1] !== undefined) {
    // Trang chi tiết mở từ Sổ cân & truy vết — vẫn tô sáng mục "table" ở menu, "Quay lại" trả về đúng đó.
    return { view: "table", passId: parts[1] };
  }
  const view = VIEWS.find((candidate) => candidate === parts[0]) ?? "live";
  return { view, passId: null };
}

function todayLabel(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
}

const SIDEBAR_STORAGE_KEY = "camera-ai:sidebar-open";

/** Chỉ là tiện ích riêng trình duyệt (nhớ trạng thái đóng/mở), không phải dữ liệu nghiệp vụ — lỗi thì bỏ qua. */
function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function App(): ReactElement {
  const [{ view, passId }, setRoute] = useState(readRoute);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  useEffect(() => {
    const onHashChange = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const toggleSidebar = (): void => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // bỏ qua — chỉ là tiện ích nhớ trạng thái, không ảnh hưởng chức năng.
    }
  };
  const titles = passId !== null ? { title: "Chi tiết lượt xe", subtitle: "" } : VIEW_TITLES[view];
  const catalog = useGateCatalog();
  const { rows, connected, message } = useGateFeed();
  const offline = !connected;

  return (
    <main className="app-shell">
      <aside className={`brand-sidebar ${sidebarOpen ? "" : "brand-sidebar-collapsed"}`}>
        <button aria-expanded={sidebarOpen} aria-label={sidebarOpen ? "Thu gọn menu" : "Mở rộng menu"} className="sidebar-toggle" type="button" onClick={toggleSidebar}>
          {sidebarOpen ? "‹" : "›"}
        </button>
        {sidebarOpen && (
          <>
            <p className="brand-mark">VP HOLDING</p>
            <p className="brand-sub">ĐIỀU HÀNH CÂN XE</p>
            <nav className="brand-nav" aria-label="Menu">
              {NAV_ITEMS.map((item) => (
                <button aria-pressed={view === item.view} key={item.view} type="button" onClick={() => { window.location.hash = `/${item.view}`; }}>
                  <span className="brand-nav-num">{item.num}</span>{item.label}
                </button>
              ))}
            </nav>
            <p className="brand-footer"><strong>MỎ ĐÁ · MỎ CÁT · BÊ TÔNG</strong>Mỗi chuyến xe, một hồ sơ.</p>
          </>
        )}
      </aside>
      <div className="content-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">VẬN HÀNH THỐNG NHẤT · {todayLabel()}</p>
            <h1>{titles.title}</h1>
            {titles.subtitle && <p className="subtitle">{titles.subtitle}</p>}
          </div>
          <span className={`status-pill ${connected ? "gate-verified" : "gate-mismatch"}`}>{connected ? "● Đã kết nối" : "● Mất kết nối trạm"}</span>
        </header>
        {passId !== null ? (
          <PassPage catalog={catalog} pass={rows.find((row) => row.id === passId) ?? null} onBack={() => { window.location.hash = "/table"; }} />
        ) : (
          <>
            {view === "live" && <LivePage catalog={catalog} message={message} offline={offline} rows={rows} />}
            {view === "confirm" && <ConfirmPage />}
            {view === "table" && <CapturesTable onOpenPass={(id) => { window.location.hash = `/pass/${id}`; }} />}
            {view === "ops" && <OpsPage />}
          </>
        )}
      </div>
    </main>
  );
}

export default App;
