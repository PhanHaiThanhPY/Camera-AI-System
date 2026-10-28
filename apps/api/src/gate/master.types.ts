export interface Vehicle {
  id: string;
  ownerId: string;
  plateNumber: string;
  plateNormalized: string;
  /** Mã trong gate.catalog.ts hoặc null nếu chưa biết. */
  vehicleType: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string;
  ownerId: string;
  vehicleId: string | null;
  fullName: string;
  phone: string;
  licenseNo: string;
  note: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VehicleMatch = "exact" | "near" | "none";

/** Kết quả đối chiếu biển số quét được với danh sách xe trong bãi. */
export interface MasterLink {
  match: VehicleMatch;
  vehicleId: string | null;
  plateNumber: string | null;
  drivers: { id: string; fullName: string; phone: string; isPrimary: boolean }[];
}

export const NO_MASTER_LINK: MasterLink = { match: "none", vehicleId: null, plateNumber: null, drivers: [] };
