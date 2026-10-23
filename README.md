# Camera AI System

Hệ thống kiểm soát xe & vật liệu tại mỏ đá: nhận diện biển số bằng AI, ghép với số liệu cân, người vận hành đối soát và chốt phiếu. Kiến trúc đầy đủ: `ARCHITECTURE.md`.

## Mục tiêu hiện tại

```text
Camera / video
  → python/detect nhận diện biển số, loại xe, vật liệu (YOLO + OCR)
  → POST /api/gate/detections
  → NestJS ghép với số liệu cân, chạy kiểm tra chéo
  → PostgreSQL
  → React hiển thị realtime, người vận hành xác nhận/chốt phiếu
```

Không lưu ảnh/video bằng chứng — mọi dữ liệu chỉ là số liệu (biển số, độ tin cậy, loại xe/vật liệu, khối lượng), lưu trong PostgreSQL qua Prisma. Cân giả lập tắt mặc định; chỉ bật `WEIGHBRIDGE_MOCK_RANDOM=true` khi chạy demo trước khi nối trạm cân thật.

## Cấu trúc — 3 lớp

```text
python/           Nhận diện biển số/xe/vật liệu (python/detect) + chỗ huấn luyện model sau này (python/train)
apps/api/         NestJS — nghiệp vụ cổng, cân, master data, Telegram
apps/dashboard/   React 19 + Vite + TanStack Query — giao diện vận hành
docs/             Nghiệp vụ chi tiết và checklist triển khai
```

Ba lớp chạy độc lập — xem `ARCHITECTURE.md` để biết chúng gọi nhau qua đâu.

## Chạy local

Yêu cầu: Node.js 20+, pnpm, Docker (cho Postgres), Python 3.11+ và FFmpeg nếu muốn chạy nhận diện.

```bash
docker compose up -d   # Postgres cho dev, cổng host 5433
pnpm install
pnpm dev                # chạy chung apps/api (NestJS) + apps/dashboard (Vite)
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:4000` (prefix `/api`)

`pnpm dev` chỉ chạy hai lớp Node (api + dashboard) — đây là "lệnh run chung". Lớp `python/` không phải package Node nên luôn chạy riêng, độc lập với lệnh trên; xem bên dưới.

Khi chạy demo không có trạm cân thật, tạo file `.env` từ `.env.example` và bật `WEIGHBRIDGE_MOCK_RANDOM=true`. Nếu triển khai thật, giữ giá trị này là `false` và đặt `WEIGHBRIDGE_API_KEY` cho endpoint trạm cân.

## Cài đặt & chạy python/detect (độc lập)

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
python/scripts/download-models.sh

.venv/bin/python python/detect/pipeline.py path/to/video.mp4 cam-01
```

Mặc định chỉ in kết quả ra stdout (một dòng JSON mỗi lượt xe). Đặt `GATE_API_URL=http://localhost:4000/api` trong môi trường trước khi chạy để nó tự đẩy từng lượt sang `apps/api`. Chi tiết, biến môi trường: `python/README.md` và `.env.example`.

## Tài liệu

- Kiến trúc đầy đủ: `ARCHITECTURE.md`.
- Nghiệp vụ cổng (trạng thái, kiểm tra chéo, master data, Telegram): `docs/gate-control-scope.md`.
- Checklist kết nối camera Hikvision/RTSP thật: `docs/hikvision-rtsp-deployment.md`.
