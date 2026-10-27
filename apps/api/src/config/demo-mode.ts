/**
 * DEMO_MODE=true: API phục vụ dữ liệu mẫu dựng sẵn (xem gate/demo-data.ts), không đụng tới Postgres —
 * dùng khi demo/giới thiệu mà chưa nối camera/cân/DB thật. Mặc định false = chạy luồng thật như bình thường.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}
