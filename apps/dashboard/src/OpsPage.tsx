import { ReactElement, useState } from "react";
import MasterPage from "./MasterPage";

type Tab = "overview" | "master";

const SITES = [
  { key: "mo-da", label: "Mỏ đá", tons: 78.84 },
  { key: "mo-cat", label: "Mỏ cát", tons: 24 },
  { key: "be-tong", label: "Cơ sở bê tông", tons: 26.5 }
] as const;

function StatBox({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="stat-box"><p className="stat-label">{label}</p><p className="stat-value">{value}</p></div>;
}

/** Bản trình bày hardcode theo bộ số liệu minh họa trong thiết kế. */
function OverviewTab(): ReactElement {
  const totalTons = SITES.reduce((sum, site) => sum + site.tons, 0);
  const maxTons = Math.max(...SITES.map((site) => site.tons));

  return (
    <>
      <div className="stat-grid cols-4 ops-stats">
        <StatBox label="Cơ sở kết nối" value="3 / 3" />
        <StatBox label="Phiếu trong mẫu" value="5" />
        <StatBox label="Khối lượng mẫu / tấn" value={totalTons.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
        <StatBox label="Ngoại lệ đã gắn cờ" value="1" />
      </div>
      <div className="ops-page-grid">
        <div className="panel gate-block">
          <h2>Sản lượng theo cơ sở · dữ liệu minh họa</h2>
          <div className="site-bars">
            {SITES.map((site) => {
              const tons = site.tons;
              return (
                <div className="site-bar-row" key={site.key}>
                  <div className="site-bar-head"><strong>{site.label}</strong><span>{`${tons.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tấn`}</span></div>
                  <div className="site-bar-track">
                    <span className="site-bar-fill" style={{ width: `${Math.max(4, (tons / maxTons) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted-text ops-chart-note">Khối lượng hàng = cân tổng − cân bì. Tổng hợp theo phiếu đã chốt.</p>
        </div>
        <div className="panel gate-block">
          <h2>Liên kết giao nhận</h2>
          <div className="delivery-links">
            <div className="delivery-link"><strong>Mỏ đá</strong><span>→</span><strong>Bê tông</strong></div>
            <div className="delivery-link"><strong>Mỏ cát</strong><span>→</span><strong>Bê tông</strong></div>
          </div>
          <p className="sim-banner delivery-note">Ghép theo mã lệnh vận chuyển để đối chiếu cân giao và cân nhận. Chênh lệch khối lượng được đưa vào hàng kiểm tra.</p>
        </div>
      </div>
    </>
  );
}

/** Điều hành ba cơ sở: tổng quan sản lượng + ngoại lệ, và danh mục xe/tài xế (gộp từ Master data). */
export default function OpsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <section className="main-column">
      <div className="panel gate-block ops-tabs">
        <button aria-pressed={tab === "overview"} className="tab-button" type="button" onClick={() => setTab("overview")}>Tổng quan</button>
        <button aria-pressed={tab === "master"} className="tab-button" type="button" onClick={() => setTab("master")}>Danh mục xe &amp; tài xế</button>
      </div>
      {tab === "overview" ? <OverviewTab /> : <MasterPage />}
    </section>
  );
}
