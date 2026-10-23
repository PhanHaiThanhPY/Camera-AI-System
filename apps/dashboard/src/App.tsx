import { ReactElement, useEffect, useRef, useState } from "react";
import ConfirmPage from "./ConfirmPage";
import CapturesTable from "./CapturesTable";
import LivePage from "./LivePage";
import OpsPage from "./OpsPage";
import TelegramPage from "./TelegramPage";
import { useGateCatalog, useGateFeed } from "./PassDetail";
import { SCENARIOS, SimControlBar } from "./SimControlBar";

type View = "live" | "confirm" | "table" | "ops" | "telegram";
const VIEWS: View[] = ["live", "confirm", "table", "ops", "telegram"];
/** Bốn mục chuẩn theo sơ đồ sidebar trong proposal (trang 08–11); Telegram là cấu hình phụ, không nằm trong menu chính. */
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
  ops: { title: "Điều hành ba cơ sở", subtitle: "" },
  telegram: { title: "Cài đặt Telegram", subtitle: "Cấu hình bot và gửi báo cáo xe ra vào theo ngày." }
};
const SIM_VIEWS: View[] = ["live", "confirm", "table", "ops"];

/** Route theo hash (#/live, #/table) nên chạy được trên mọi static host. */
function readView(): View {
  const name = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.find((view) => view === name) ?? "live";
}

function todayLabel(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
}

function App(): ReactElement {
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const onHashChange = (): void => setView(readView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const titles = VIEW_TITLES[view];
  const catalog = useGateCatalog();
  const { rows, connected, message } = useGateFeed();
  const [scenario, setScenario] = useState<string>(SCENARIOS[0].value);
  const [simPhase, setSimPhase] = useState(0);
  const [simRunId, setSimRunId] = useState(0);
  const [simLinkDown, setSimLinkDown] = useState(false);
  const simTimer = useRef<number | null>(null);
  const simRunning = simPhase > 0 && simPhase < 4;
  const offline = !connected || simLinkDown;
  useEffect(() => () => { if (simTimer.current !== null) window.clearInterval(simTimer.current); }, []);
  const runSimulation = (): void => {
    if (simTimer.current !== null) window.clearInterval(simTimer.current);
    setSimRunId((current) => current + 1);
    setSimPhase(0);
    setSimLinkDown(false);
    let phase = 0;
    simTimer.current = window.setInterval(() => {
      phase += 1;
      setSimPhase(phase);
      if (phase >= 4 && simTimer.current !== null) {
        window.clearInterval(simTimer.current);
        simTimer.current = null;
      }
    }, 900);
  };
  const resetSimulation = (): void => {
    if (simTimer.current !== null) window.clearInterval(simTimer.current);
    simTimer.current = null;
    setSimPhase(0);
    setSimLinkDown(false);
    setScenario(SCENARIOS[0].value);
  };

  return (
    <main className="app-shell">
      <aside className="brand-sidebar">
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
        <div className="brand-settings">
          <button type="button" onClick={() => { window.location.hash = "/telegram"; }}>Cài đặt Telegram</button>
        </div>
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
        {SIM_VIEWS.includes(view) && (
          <>
            <p className="sim-banner">MÔ PHỎNG TƯƠNG TÁC · Dữ liệu và cảnh camera minh họa · Các nút thao tác chạy trên bộ dữ liệu mô phỏng.</p>
            <SimControlBar sim={{
              scenario,
              setScenario,
              simRunning,
              offline,
              run: runSimulation,
              reset: resetSimulation,
              toggleLink: () => setSimLinkDown((isDown) => !isDown)
            }}
            />
          </>
        )}
        {view === "live" && <LivePage key={simRunId} catalog={catalog} message={message} offline={offline} rows={rows} simulationPhase={simPhase} scenario={scenario} />}
        {view === "confirm" && <ConfirmPage catalog={catalog} offline={offline} rows={rows} />}
        {view === "table" && <CapturesTable />}
        {view === "ops" && <OpsPage />}
        {view === "telegram" && <TelegramPage />}
      </div>
    </main>
  );
}

export default App;
