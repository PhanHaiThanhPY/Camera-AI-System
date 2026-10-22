import { ReactElement, useEffect, useState } from "react";
import CapturesTable from "./CapturesTable";
import LivePage from "./LivePage";
import MasterPage from "./MasterPage";
import TelegramPage from "./TelegramPage";

type View = "live" | "table" | "master" | "telegram";
const VIEWS: View[] = ["live", "table", "master", "telegram"];

/** Route theo hash (#/live, #/table) nên chạy được trên mọi static host. */
function readView(): View {
  const name = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.find((view) => view === name) ?? "live";
}

function App(): ReactElement {
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const onHashChange = (): void => setView(readView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAMERA AI / MVP</p>
          <h1>Kiểm soát xe &amp; cân</h1>
          <p className="subtitle">Chọn video để nhận diện biển số, chụp ảnh xe và đá, ghép với số liệu cân.</p>
        </div>
        <div className="system-chip"><span className="status-dot" /> Local LPR model</div>
      </header>
      <nav className="view-tabs" aria-label="Menu">
        <button aria-pressed={view === "live"} type="button" onClick={() => { window.location.hash = "/live"; }}>Realtime</button>
        <button aria-pressed={view === "table"} type="button" onClick={() => { window.location.hash = "/table"; }}>Danh sách ảnh đã chụp</button>
        <button aria-pressed={view === "master"} type="button" onClick={() => { window.location.hash = "/master"; }}>Master data</button>
        <button aria-pressed={view === "telegram"} type="button" onClick={() => { window.location.hash = "/telegram"; }}>Telegram</button>
      </nav>
      {view === "live" && <LivePage />}
      {view === "table" && <CapturesTable />}
      {view === "master" && <MasterPage />}
      {view === "telegram" && <TelegramPage />}
    </main>
  );
}

export default App;
