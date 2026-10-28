# Triển khai lên VPS (domain + HTTPS)

Checklist triển khai hệ thống lên 1 VPS Linux riêng (có domain, truy cập qua Internet). Repo hiện chưa có
Dockerfile/pm2/systemd có sẵn — đây là cách chạy đúng với kiến trúc hiện tại: `apps/api` (NestJS, cổng 4000,
chạy bằng `node dist/src/main.js`) + `apps/dashboard` (Vite build tĩnh) + Postgres/MinIO qua Docker. Lớp
`python/detect` KHÔNG chạy trên VPS — chạy tại cơ sở (nơi có camera/RTSP thật), trỏ `GATE_API_URL` về domain
VPS (xem mục J).

Không có quyền SSH vào VPS thì không chạy được các lệnh dưới — đây là checklist để tự làm trên VPS, không
phải script tự động.

## A. Chuẩn bị
- VPS Ubuntu 22.04+ (tối thiểu 2 vCPU/4GB RAM nếu chạy cả nhận diện; chỉ 1-2 vCPU/2GB nếu python/detect chạy
  ở máy khác tại cơ sở).
- DNS: tạo record `A your-domain.com → <IP VPS>`.
- SSH vào VPS được, có quyền sudo.

## B. Cài công cụ nền trên VPS
```bash
sudo apt update && sudo apt install -y git curl ufw
# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
# Node 20 qua nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 20
corepack enable && corepack prepare pnpm@10.14.0 --activate
# Caddy (reverse proxy + tự xin TLS Let's Encrypt, không cần certbot riêng)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## C. Lấy code + cài dependencies
```bash
git clone <repo-url> /opt/camera-ai-system   # hoặc scp code lên nếu chưa có remote git
cd /opt/camera-ai-system
pnpm install
```

## D. Hạ tầng Postgres + MinIO
```bash
docker compose up -d
```
Port `5433`/`9000`/`9001` không nên lộ ra internet — chặn ở firewall (mục I), không cần sửa `docker-compose.yml`.

## E. Cấu hình `apps/api/.env`
Đây là file API **thực sự đọc** lúc chạy (`dotenv/config` nạp theo cwd của tiến trình, tức `apps/api/`) —
không phải file `.env` ở gốc repo. Sửa sai file này là nguyên nhân phổ biến nhất khiến cấu hình "set rồi mà
không ăn".
```bash
cp .env.example apps/api/.env
nano apps/api/.env
```
Đặt tối thiểu (chạy thật, không demo):
- `DEMO_MODE=false`
- `DATABASE_URL=postgresql://camera_ai:camera_ai@localhost:5433/camera_ai`
- `HOST=127.0.0.1` (giữ nguyên — Caddy reverse-proxy vào, không expose thẳng cổng 4000 ra ngoài)
- `CORS_ORIGINS=https://your-domain.com`
- `JWT_SECRET=` — chạy `openssl rand -hex 32` rồi dán giá trị vào
- `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` — tài khoản admin đầu tiên, đổi mật khẩu ngay sau khi đăng
  nhập lần đầu
- `WEIGHBRIDGE_MOCK_RANDOM=false`, đặt `WEIGHBRIDGE_API_KEY` (trạm cân thật gửi đúng key này qua header
  `X-Weighbridge-Key`)
- `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` nếu dùng bot báo cáo; `DEEPSEEK_API_KEY`/
  `TELEGRAM_ASSISTANT_ALLOWED_CHAT_IDS` nếu muốn trợ lý hỏi đáp tự do (xem `docs/gate-control-scope.md`)
- Nếu dùng MinIO lưu ảnh: `MINIO_PUBLIC_URL=https://your-domain.com/storage` (cần thêm route `/storage` ở
  Caddyfile nếu muốn ảnh truy cập public; không cần ảnh public thì để trống `MINIO_ENDPOINT` để tắt hẳn
  tính năng lưu ảnh)

## F. Migrate DB + build
```bash
cd apps/api && pnpm db:deploy   # prisma migrate deploy — áp hết migration có sẵn trong repo
cd /opt/camera-ai-system
pnpm --filter @camera-ai/api build
VITE_API_URL=https://your-domain.com/api pnpm --filter @camera-ai/dashboard build
```
`VITE_API_URL` bắt buộc lúc build dashboard (Vite inline giá trị này vào bundle tĩnh) — không set thì
dashboard gọi thẳng `localhost:4000`, sai ở production. Build dashboard ra ở `apps/dashboard/dist/`.

## G. Chạy API bền bỉ bằng systemd
Tự khởi động lại khi crash hoặc reboot VPS — tránh tình trạng tiến trình chết rồi không ai khởi động lại
(gây hiện tượng "set env/deploy code mới rồi mà vẫn chạy bản cũ" vì cổng 4000 bị một tiến trình cũ chiếm).
```bash
sudo tee /etc/systemd/system/camera-ai-api.service << 'EOF'
[Unit]
Description=Camera AI System API
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/camera-ai-system/apps/api
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node dist/src/main.js
Restart=always
RestartSec=3
User=<linux-user-cua-ban>

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now camera-ai-api
sudo systemctl status camera-ai-api
```
Deploy code mới sau này: `git pull`, build lại (mục F), rồi `sudo systemctl restart camera-ai-api` — systemd
đảm bảo cổng 4000 luôn do đúng 1 tiến trình (bản mới nhất) giữ.

`NODE_ENV=production` bắt buộc để cookie đăng nhập (`cas_session`) có cờ `Secure` đúng chuẩn khi chạy sau
Caddy/HTTPS (xem `apps/api/src/auth/auth.service.ts`).

## H. Caddy: domain + TLS + serve dashboard + proxy API
```bash
sudo tee /etc/caddy/Caddyfile << 'EOF'
your-domain.com {
    handle /api/* {
        reverse_proxy 127.0.0.1:4000
    }
    handle {
        root * /opt/camera-ai-system/apps/dashboard/dist
        try_files {path} /index.html
        file_server
    }
}
EOF
sudo systemctl reload caddy
```
Caddy tự xin/đổi mới chứng chỉ Let's Encrypt — không cần certbot riêng. SSE (`/api/live/events`, trạm cân
trực tiếp) chạy bình thường qua Caddy, không cần cấu hình thêm. Dashboard + API cùng 1 domain (same-origin)
nên không cần lo CORS/cookie cross-site — `sameSite: "lax"` ở `auth.service.ts` hoạt động đúng với kiểu này.

## I. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```
Port 4000/5433/9000/9001 **không** mở ra ngoài — chỉ Caddy/docker gọi nội bộ qua `127.0.0.1`.

## J. python/detect (chạy tại cơ sở, không phải trên VPS)
Mỗi camera là 1 tiến trình, chạy ngay tại máy ở cơ sở (nơi có camera/RTSP), trỏ về domain VPS:
```bash
export GATE_API_URL=https://your-domain.com/api
.venv/bin/python python/detect/pipeline.py <rtsp-url-hoac-video> cam-01
```
Chi tiết biến môi trường/cài đặt: `python/README.md`.

## K. Kiểm tra cuối
```bash
curl https://your-domain.com/api/health
```
Vào `https://your-domain.com`, đăng nhập bằng `ADMIN_EMAIL`/`ADMIN_PASSWORD` đã đặt ở mục E, đổi mật khẩu
ngay sau khi đăng nhập lần đầu.

## Lỗi hay gặp
- **Sửa `.env` rồi mà không ăn / chạy bản cũ sau khi deploy**: kiểm tra đang sửa đúng `apps/api/.env` (không
  phải `.env` ở gốc repo), và tiến trình cũ đã bị dừng trước khi tiến trình mới bind cổng 4000 (`sudo
  systemctl restart camera-ai-api` lo việc này; nếu chạy tay bằng `node dist/src/main.js` thì phải tự kill
  tiến trình cũ trước — `lsof -nP -iTCP:4000 -sTCP:LISTEN`).
- **Bot Telegram không trả lời**: kiểm tra `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` nằm trong đúng
  `apps/api/.env`, process API đang chạy là bản mới nhất (xem lỗi trên), và `TELEGRAM_ASSISTANT_ALLOWED_CHAT_IDS`
  (hoặc `TELEGRAM_CHAT_ID`) khớp đúng chat đang nhắn cho bot.
