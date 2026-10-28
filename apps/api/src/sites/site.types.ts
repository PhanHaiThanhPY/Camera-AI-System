export interface SiteCamera {
  id: string;
  siteId: string;
  cameraId: string;
  label: string;
  rtspUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** Phạm vi site cho các hàm đọc/xoá dữ liệu theo site (GatePass/WeighReading) — allSites chỉ ADMIN
 *  mới được dùng (kiểm tra ở SitesService.resolveSiteScope). */
export type SiteScope = { siteId: string } | { allSites: true };

export interface Site {
  id: string;
  ownerId: string;
  name: string;
  scaleId: string;
  weighbridgeApiKey: string;
  createdAt: string;
  updatedAt: string;
}
