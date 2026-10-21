const KG_STEP = 100;

function randomStep(minKg: number, maxKg: number): number {
  const steps = Math.floor((maxKg - minKg) / KG_STEP);
  return minKg + Math.floor(Math.random() * (steps + 1)) * KG_STEP;
}

/**
 * Cân nặng giả lập, random mỗi lần gọi (mỗi lần chụp được biển số).
 * Tare (xe không) 1,0–1,5 tấn, hàng 0,6–1,5 tấn, làm tròn 100 kg (ví dụ 1 tấn 1, 1 tấn 2).
 * Tắt bằng WEIGHBRIDGE_MOCK_RANDOM=false khi đã nối trạm cân thật.
 */
export function randomWeights(): { tareKg: number; netKg: number; grossKg: number } {
  const tareKg = randomStep(1000, 1500);
  const netKg = randomStep(600, 1500);
  return { tareKg, netKg, grossKg: tareKg + netKg };
}
