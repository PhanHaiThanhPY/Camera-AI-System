#!/usr/bin/env bash
# Đo tải hiện tại của cả 3 lớp (apps/dashboard, apps/api, python) + Postgres. Chỉ đọc, không đổi gì.
# Nhận diện được cả tiến trình chạy kiểu dev (pnpm dev / nest start --watch) lẫn kiểu production
# (pnpm start / node dist/src/main.js) — cùng một script dùng được trên máy dev lẫn trên VPS.
#
# Chạy tại chỗ:  scripts/measure.sh [api_url] [streamsim_url]
# Chạy qua SSH:  scripts/measure.sh --ssh user@vps-host [api_url] [streamsim_url]
#   (SSH vào máy đó rồi chạy đúng script này, không cần cài gì thêm trên VPS ngoài
#   pgrep/ps/curl — những lệnh có sẵn trên hầu hết Linux)
#
# Mặc định api_url=http://localhost:4000, streamsim_url=http://localhost:8800 — đúng cho cả máy dev
# lẫn khi chạy ngay trên VPS (nơi "localhost" chính là máy đang chạy service).

set -uo pipefail

if [ "${1:-}" = "--ssh" ]; then
  SSH_TARGET="${2:-}"
  if [ -z "$SSH_TARGET" ]; then
    echo "Dùng: scripts/measure.sh --ssh user@host [api_url] [streamsim_url]" >&2
    exit 1
  fi
  shift 2
  REMOTE_API_URL="${1:-http://localhost:4000}"
  REMOTE_STREAMSIM_URL="${2:-http://localhost:8800}"
  echo "Đo trên $SSH_TARGET qua SSH…"
  echo
  # Gửi thẳng nội dung script này qua stdin cho bash ở máy đích chạy — không cần copy file,
  # không cần cài gì thêm trên VPS ngoài các lệnh chuẩn (pgrep/ps/curl/docker nếu có).
  exec ssh "$SSH_TARGET" "bash -s -- '$REMOTE_API_URL' '$REMOTE_STREAMSIM_URL'" < "$0"
fi

API_URL="${1:-http://localhost:4000}"
STREAMSIM_URL="${2:-http://localhost:8800}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

proc_line() {
  local label="$1" pattern="$2"
  local pids pid count extra=""
  pids=$(pgrep -f "$pattern" 2>/dev/null)
  if [ -z "$pids" ]; then
    printf '  %-26s không chạy\n' "$label"
    return
  fi
  pid=$(echo "$pids" | head -1)
  count=$(echo "$pids" | wc -l | tr -d ' ')
  if [ "$count" -gt 1 ]; then
    extra="  (⚠ $count tiến trình khớp — có thể có cái bị mồ côi, kiểm tra 'pgrep -fl \"$pattern\"')"
  fi
  # ps: %cpu, rss (KB), etime (giờ đã chạy) — rss/1024 quy ra MB.
  ps -p "$pid" -o pcpu=,rss=,etime= 2>/dev/null | awk -v label="$label" -v pid="$pid" -v extra="$extra" \
    '{printf "  %-26s pid=%-7s cpu=%-6s%% mem=%-8.0fMB uptime=%s%s\n", label, pid, $1, $2/1024, $3, extra}'
}

json_or_note() {
  local url="$1" note="$2"
  local body
  if body=$(curl -fsS --max-time 2 "$url" 2>/dev/null); then
    if command -v python3 >/dev/null 2>&1; then
      echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
      echo "$body"
    fi
  else
    echo "  (không gọi được $url — $note)"
  fi
}

bold "=== Tiến trình (ps) ==="
# Mỗi pattern khớp cả dạng dev lẫn dạng production.
proc_line "apps/dashboard" "apps/dashboard.*vite"
echo "    (ở production dashboard thường là file tĩnh qua nginx/Caddy — 'không chạy' ở đây là bình thường, đo web server riêng)"
proc_line "apps/api" "apps/api.*(nest|dist.*main\\.js)"
proc_line "python/detect/pipeline" "python/detect/pipeline.py"
proc_line "python/streamsim" "python/streamsim/server.py"

echo
bold "=== Postgres + MinIO (docker) ==="
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null \
    | awk 'NR==1 || /camera-ai-postgres|camera-ai-minio/' \
    || echo "  Docker có cài nhưng không gọi được (daemon chưa chạy?)."
else
  echo "  Không có docker trên máy này — nếu Postgres/MinIO chạy ngoài Docker, tự xem bằng công cụ của hệ quản trị đó."
fi

echo
bold "=== apps/api  GET $API_URL/api/health ==="
json_or_note "$API_URL/api/health" "API có đang chạy không?"

echo
bold "=== python/streamsim  GET $STREAMSIM_URL/health ==="
json_or_note "$STREAMSIM_URL/health" "streamsim có đang chạy không?"
