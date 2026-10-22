# Camera AI System

MVP nhận diện xe và biển số từ video upload.

## Mục tiêu hiện tại

```text
Upload video
  → NestJS tạo job
  → Python worker xử lý video
  → tạo snapshot/video bằng chứng
  → trả detection, confidence và thời điểm phát hiện
  → React hiển thị kết quả
```

Worker đọc biển số thật từ video: YOLO khoanh vùng biển số → RapidOCR đọc ký tự → gom theo từng xe → chụp ảnh biển số, xe, đá từ frame tốt nhất. Cân giả lập được tắt mặc định; chỉ bật `WEIGHBRIDGE_MOCK_RANDOM=true` khi chạy demo trước khi nối trạm cân thật.

## Cấu trúc

```text
apps/api                 NestJS API, lưu job trong memory ở giai đoạn MVP và state cổng trong JSON
apps/web                 React 19 + Vite + TanStack Query dashboard
services/ai-worker       Python worker và adapter xử lý video
storage/uploads          video gốc
storage/results          snapshot và video kết quả
docs                     tài liệu kiến trúc và quyết định kỹ thuật
```

## Chạy local

Yêu cầu: Node.js 20+, pnpm, Python 3.11+ và FFmpeg.

```bash
pnpm install
pnpm dev
```

Sau đó mở `http://localhost:5173`.

API chạy tại `http://localhost:4000`.

Khi chạy demo không có trạm cân thật, tạo file `.env` từ `.env.example` và bật `WEIGHBRIDGE_MOCK_RANDOM=true`. Nếu triển khai thật, giữ giá trị này là `false` và đặt `WEIGHBRIDGE_API_KEY` cho endpoint trạm cân.

## Cài đặt worker

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/ai-worker/requirements.txt
scripts/download-models.sh
```

API tự dùng `.venv/bin/python` nếu có. Biến môi trường xem `.env.example`.

Giao diện có 2 menu: **Realtime** (chọn video, nhận diện và hiện kết quả ngay khi xe được xác nhận, khung biển số vẽ trên video) và **Danh sách ảnh đã chụp** (bảng kiểu Excel, mỗi loại ảnh một cột). Chi tiết nghiệp vụ: `docs/gate-control-scope.md`.

Workflow và kịch bản demo: `docs/demo-workflow.md`. Checklist kết nối camera Hikvision: `docs/hikvision-rtsp-deployment.md`.
