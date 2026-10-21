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

MVP đang bật `AI_DEMO_MODE=true` để kiểm tra toàn bộ luồng. Pipeline LPR thật đã được tích hợp trong worker nhưng cần model detector biển số và các Python dependency tương ứng. Demo mode dùng FFmpeg để lấy snapshot và copy video gốc làm bằng chứng, giúp kết quả trả về nhanh; biển số mẫu mặc định là `DEMO-PLATE`.

## Cấu trúc

```text
apps/api                 NestJS API, lưu job trong memory ở giai đoạn MVP
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

## Bật LPR thật

```bash
cd services/ai-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Đặt model detector biển số vào `models/license-plate-detector.pt`, sau đó cập nhật biến môi trường:

```bash
AI_DEMO_MODE=false
LPR_MODEL_PATH=./models/license-plate-detector.pt
LPR_CONFIDENCE=0.35
LPR_SAMPLE_SECONDS=1.0
LPR_RENDER_ANNOTATED_VIDEO=false
```

Model cần trả về bounding box vùng biển số. Worker dùng RapidOCR để đọc ký tự nhiều dòng trong từng vùng, gom các lần phát hiện trùng biển số và tạo ảnh toàn cảnh có khung cùng ảnh crop biển số. Để tăng tốc, video kết quả mặc định giữ nguyên video gốc; đặt `LPR_RENDER_ANNOTATED_VIDEO=true` nếu cần encode video có khung AI.

## Biến môi trường

```bash
PORT=4000
STORAGE_ROOT=../../storage
PYTHON_BIN=python3
AI_DEMO_MODE=true
DEMO_PLATE_NUMBER=51C-123.45
LPR_MODEL_PATH=./models/license-plate-detector.pt
LPR_CONFIDENCE=0.35
LPR_SAMPLE_SECONDS=1.0
LPR_RENDER_ANNOTATED_VIDEO=false
```

## API MVP

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| `POST` | `/api/videos` | Upload video và tạo job |
| `GET` | `/api/videos` | Danh sách job |
| `GET` | `/api/videos/:id` | Trạng thái và kết quả job |
| `GET` | `/api/videos/:id/result` | Chỉ lấy phần detection |

## Bước tiếp theo

1. Đưa job store sang PostgreSQL và queue sang Redis/BullMQ.
2. Thêm xác nhận thủ công biển số và audit log.
3. Bổ sung camera RTSP/ONVIF sau khi có video mẫu và vị trí camera thực tế.

