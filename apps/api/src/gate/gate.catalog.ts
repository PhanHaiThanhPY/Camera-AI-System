export interface CatalogItem {
  code: string;
  label: string;
}

export interface VehicleProfile extends CatalogItem {
  /** Khoảng khối lượng xe không tải (kg) hợp lý. Giá trị mặc định cần hiệu chỉnh theo đội xe thực tế. */
  tareKgRange: [number, number];
  maxGrossKg: number;
}

export const VEHICLE_PROFILES: VehicleProfile[] = [
  { code: "dump_truck", label: "Xe ben", tareKgRange: [6000, 18000], maxGrossKg: 48000 },
  { code: "tractor_trailer", label: "Xe đầu kéo + rơ moóc", tareKgRange: [12000, 26000], maxGrossKg: 60000 },
  { code: "flatbed_truck", label: "Xe tải thùng", tareKgRange: [2500, 10000], maxGrossKg: 30000 },
  { code: "truck", label: "Xe tải", tareKgRange: [800, 18000], maxGrossKg: 60000 },
  { code: "bus", label: "Xe khách", tareKgRange: [3000, 16000], maxGrossKg: 30000 },
  { code: "light_truck", label: "Xe tải nhỏ", tareKgRange: [800, 2500], maxGrossKg: 5000 },
  { code: "pickup", label: "Xe bán tải", tareKgRange: [1000, 3000], maxGrossKg: 4000 },
  { code: "car", label: "Xe con", tareKgRange: [800, 2400], maxGrossKg: 3500 },
  { code: "motorcycle", label: "Xe máy", tareKgRange: [80, 400], maxGrossKg: 600 }
];

export const MATERIALS: CatalogItem[] = [
  { code: "empty", label: "Không chở hàng" },
  { code: "da_bi", label: "Đá bi" },
  { code: "da_vuong", label: "Đá vuông" }
];

export const EMPTY_MATERIAL = "empty";

export function findVehicleProfile(code: string | null): VehicleProfile | undefined {
  return VEHICLE_PROFILES.find((profile) => profile.code === code);
}

export function isKnownMaterial(code: string): boolean {
  return MATERIALS.some((material) => material.code === code);
}
