const KG_STEP = 100;

function randomStep(minKg: number, maxKg: number): number {
  const steps = Math.floor((maxKg - minKg) / KG_STEP);
  return minKg + Math.floor(Math.random() * (steps + 1)) * KG_STEP;
}

/**
 * Cân nặng giả lập, random mỗi lần gọi (hard code, chưa có trạm cân thật — tắt bằng WEIGHBRIDGE_MOCK_RANDOM=false).
 * Tare (xe không, lúc vào) 1,0–1,5 tấn; hàng (đá chở ra) 0,6–1,5 tấn, làm tròn 100 kg (ví dụ 1 tấn 1, 1 tấn 2).
 * Gross (lúc ra) = tare + hàng.
 */
export function randomTareKg(): number {
  return randomStep(1000, 1500);
}

export function randomNetKg(): number {
  return randomStep(600, 1500);
}
