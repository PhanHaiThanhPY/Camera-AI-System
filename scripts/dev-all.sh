#!/usr/bin/env bash
# Chạy tổng cả 3 lớp (apps/dashboard, apps/api, python) + hạ tầng (Postgres/MinIO) bằng 1 lệnh,
# cho máy dev. Ctrl+C một lần là tắt hết, không để sót tiến trình con.
#
# Dùng:   scripts/dev-all.sh
#         scripts/dev-all.sh --with-streamsim     (mở thêm python/streamsim để giả lập camera)
#
# Log của từng phần nằm ở logs/*.log (xem song song: tail -f logs/*.log).

set -uo pipefail
cd "$(dirname "$0")/.."

WITH_STREAMSIM=false
if [ "${1:-}" = "--with-streamsim" ]; then
  WITH_STREAMSIM=true
fi

# ====== Camera cho python/detect/pipeline.py — sửa ở đây rồi chạy lại ======
# Mỗi dòng: "nguồn|cameraId". Nguồn là đường dẫn file video, http(s), hoặc rtsp://user:pass@ip/...
# (dùng đúng link đã dán ở python/streamsim nếu bạn test qua đó). Để trống [] = không chạy pipeline,
# chỉ lên dashboard + api (hợp lý khi chưa nối camera thật — xem docs/hikvision-rtsp-deployment.md).
CAMERAS=(
  # "rtsp://user:pass@192.168.1.10:554/Streaming/Channels/101|cam-front"
  # "path/to/video-test.mp4|cam-rear"
)
# ============================================================================

LOG_DIR="logs"
mkdir -p "$LOG_DIR"
PIDS=()

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

cleanup() {
  echo ""
  bold "Đang tắt tất cả tiến trình…"
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  echo "Đã tắt. Log vẫn còn ở $LOG_DIR/ nếu cần xem lại."
  exit 0
}
trap cleanup INT TERM

bold "==> Hạ tầng: Postgres + MinIO (docker compose)"
docker compose up -d postgres minio

bold "==> Chờ Postgres sẵn sàng…"
until docker compose exec -T postgres pg_isready -U camera_ai -d camera_ai >/dev/null 2>&1; do
  sleep 1
done
echo "    OK."

bold "==> apps/api (NestJS, watch mode)"
pnpm --filter @camera-ai/api dev > "$LOG_DIR/api.log" 2>&1 &
PIDS+=("$!")

bold "==> apps/dashboard (Vite)"
pnpm --filter @camera-ai/dashboard dev > "$LOG_DIR/dashboard.log" 2>&1 &
PIDS+=("$!")

if [ "$WITH_STREAMSIM" = true ]; then
  bold "==> python/streamsim (giả lập 4 góc camera, mở http://localhost:8800)"
  .venv/bin/python python/streamsim/server.py > "$LOG_DIR/streamsim.log" 2>&1 &
  PIDS+=("$!")
fi

if [ ${#CAMERAS[@]} -eq 0 ]; then
  bold "==> python/detect: chưa khai báo camera nào trong CAMERAS ở đầu file này — bỏ qua."
  echo "    Sửa scripts/dev-all.sh, điền nguồn (file video hoặc rtsp://...) + cameraId cho mỗi góc, rồi chạy lại."
else
  export GATE_API_URL="${GATE_API_URL:-http://localhost:4000/api}"
  for entry in "${CAMERAS[@]}"; do
    source_part="${entry%%|*}"
    camera_id="${entry##*|}"
    bold "==> python/detect/pipeline.py — $camera_id <- $source_part"
    .venv/bin/python python/detect/pipeline.py "$source_part" "$camera_id" > "$LOG_DIR/pipeline-$camera_id.log" 2>&1 &
    PIDS+=("$!")
  done
fi

echo ""
bold "Đang chạy — Ctrl+C để tắt hết."
echo "  Dashboard:  http://localhost:5173"
echo "  API health: http://localhost:4000/api/health"
[ "$WITH_STREAMSIM" = true ] && echo "  Streamsim:  http://localhost:8800"
echo "  Log:        $LOG_DIR/*.log"
echo ""

wait
