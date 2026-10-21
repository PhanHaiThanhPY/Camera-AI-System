import { ReactElement, useEffect, useState } from "react";
import CapturesTable from "./CapturesTable";
import LivePage from "./LivePage";

type View = "live" | "table";

/** Route theo hash (#/live, #/table) nên chạy được trên mọi static host. */
function readView(): View {
  return window.location.hash.replace(/^#\/?/, "") === "table" ? "table" : "live";
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
      </nav>
      {view === "live" ? <LivePage /> : <CapturesTable />}
    </main>
  );
}

export default App;
