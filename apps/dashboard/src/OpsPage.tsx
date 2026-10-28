import { ReactElement, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import MasterPage from "./MasterPage";
import { request } from "./PassDetail";
import type { GatePass } from "./PassDetail";
import SitesPage from "./SitesPage";

type Tab = "overview" | "sites" | "master";

function StatBox({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="stat-box"><p className="stat-label">{label}</p><p className="stat-value">{value}</p></div>;
}

const FLAGGED_STATUSES = new Set(["REVIEW_REQUIRED", "MISMATCH", "CAPTURE_FAILED"]);

interface SiteProduction {
  id: string;
  label: string;
  passCount: number;
  confirmedCount: number;
  tons: number;
  flagged: number;
}

/** Tổng quan sản lượng thật theo từng cơ sở (của account đang đăng nhập, hoặc mọi cơ sở nếu ADMIN
 *  đang xem "Tất cả") — không còn số liệu minh họa. */
function OverviewTab(): ReactElement {
  const { user, sites } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const productionQuery = useQuery({
    queryKey: ["ops-production", sites.map((site) => site.id).join(",")],
    queryFn: async (): Promise<SiteProduction[]> => {
      const results = await Promise.all(
        sites.map(async (site): Promise<SiteProduction> => {
          const passes = await request<GatePass[]>(`/passes?siteId=${encodeURIComponent(site.id)}`);
          const confirmed = passes.filter((pass) => pass.resolution === "CONFIRMED");
          const tons = confirmed.reduce((sum, pass) => sum + (pass.weighing?.netKg ?? 0), 0) / 1000;
          const flagged = passes.filter((pass) => FLAGGED_STATUSES.has(pass.status)).length;
          const label = isAdmin && site.ownerName !== undefined ? `${site.name} — ${site.ownerName}` : site.name;
          return { id: site.id, label, passCount: passes.length, confirmedCount: confirmed.length, tons, flagged };
        })
      );
      return results;
    },
    enabled: sites.length > 0
  });

  const production = productionQuery.data ?? [];
  const totalTons = production.reduce((sum, item) => sum + item.tons, 0);
  const totalPasses = production.reduce((sum, item) => sum + item.passCount, 0);
  const totalFlagged = production.reduce((sum, item) => sum + item.flagged, 0);
  const maxTons = Math.max(1, ...production.map((item) => item.tons));

  if (sites.length === 0) {
    return <p className="muted-text">Chưa có cơ sở nào — tạo cơ sở ở trang "Cơ sở" trước.</p>;
  }

  return (
    <>
      <div className="stat-grid cols-4 ops-stats">
        <StatBox label="Cơ sở" value={`${sites.length}`} />
        <StatBox label="Phiếu đã ghi nhận" value={`${totalPasses}`} />
        <StatBox label="Khối lượng đã xác nhận / tấn" value={totalTons.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
        <StatBox label="Ngoại lệ đã gắn cờ" value={`${totalFlagged}`} />
      </div>
      <div className="ops-page-grid">
        <div className="panel gate-block">
          <h2>Sản lượng theo cơ sở</h2>
          <div className="site-bars">
            {production.length === 0 && <p className="muted-text">Đang tải…</p>}
            {production.map((item) => (
              <div className="site-bar-row" key={item.id}>
                <div className="site-bar-head"><strong>{item.label}</strong><span>{`${item.tons.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tấn`}</span></div>
                <div className="site-bar-track">
                  <span className="site-bar-fill" style={{ width: `${Math.max(4, (item.tons / maxTons) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="muted-text ops-chart-note">Khối lượng hàng = cân tổng − cân bì, tổng hợp theo phiếu đã xác nhận.</p>
        </div>
        <div className="panel gate-block">
          <h2>Chi tiết theo cơ sở</h2>
          <div className="sheet-wrap">
            <table className="sheet compact">
              <thead><tr><th>Cơ sở</th><th>Phiếu</th><th>Đã xác nhận</th><th>Gắn cờ</th></tr></thead>
              <tbody>
                {production.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td className="cell-num">{item.passCount}</td>
                    <td className="cell-num">{item.confirmedCount}</td>
                    <td className="cell-num">{item.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/** Điều hành: báo cáo sản lượng/ngoại lệ theo cơ sở thật, tạo/sửa cơ sở, và danh mục xe/tài xế. */
export default function OpsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <section className="main-column">
      <div className="panel gate-block ops-tabs">
        <button aria-pressed={tab === "overview"} className="tab-button" type="button" onClick={() => setTab("overview")}>Báo cáo</button>
        <button aria-pressed={tab === "sites"} className="tab-button" type="button" onClick={() => setTab("sites")}>Cơ sở</button>
        <button aria-pressed={tab === "master"} className="tab-button" type="button" onClick={() => setTab("master")}>Danh mục xe &amp; tài xế</button>
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "sites" && <SitesPage />}
      {tab === "master" && <MasterPage />}
    </section>
  );
}
