const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export interface SiteCamera {
  id: string;
  siteId: string;
  cameraId: string;
  label: string;
  rtspUrl: string;
}

export interface Site {
  id: string;
  ownerId: string;
  name: string;
  scaleId: string;
  weighbridgeApiKey: string;
  /** Chỉ có khi gọi với tư cách ADMIN (xem danh sách của mọi đối tác). */
  ownerName?: string;
  ownerEmail?: string;
}

async function sitesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/sites${path}`, { ...init, credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Yêu cầu thất bại.");
  }
  return response.json() as Promise<T>;
}

export const listSites = (): Promise<Site[]> => sitesFetch<Site[]>("");

export const createSite = (name: string): Promise<Site> =>
  sitesFetch<Site>("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });

export interface SiteUpdateInput {
  name?: string;
  scaleId?: string;
  weighbridgeApiKey?: string;
}

export const updateSite = (id: string, input: SiteUpdateInput): Promise<Site> =>
  sitesFetch<Site>(`/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });

export const deleteSite = (id: string): Promise<{ ok: true }> => sitesFetch<{ ok: true }>(`/${id}`, { method: "DELETE" });

export const listCameras = (siteId: string): Promise<SiteCamera[]> => sitesFetch<SiteCamera[]>(`/${siteId}/cameras`);

export const addCamera = (siteId: string, input: { label?: string; rtspUrl?: string }): Promise<SiteCamera> =>
  sitesFetch<SiteCamera>(`/${siteId}/cameras`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });

export const updateCamera = (cameraRowId: string, input: { label?: string; rtspUrl?: string }): Promise<SiteCamera> =>
  sitesFetch<SiteCamera>(`/cameras/${cameraRowId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });

export const removeCamera = (cameraRowId: string): Promise<{ ok: true }> => sitesFetch<{ ok: true }>(`/cameras/${cameraRowId}`, { method: "DELETE" });
