# Kiến trúc hệ thống

Bản đồ định hướng cho người mới đọc code lần đầu. Không phải tài liệu API đầy đủ — chi tiết nghiệp vụ xem `docs/gate-control-scope.md`, checklist nối camera thật xem `docs/hikvision-rtsp-deployment.md`.

## 3 lớp

```text
python/           Python — nhận diện biển số/xe/vật liệu từ video hoặc luồng camera, đẩy kết quả
apps/api/         NestJS — nhận kết quả nhận diện, nghiệp vụ cổng (cân, đối soát), master data, Telegram
apps/dashboard/   React 19 + Vite — giao diện vận hành cổng (gate)
```

Không lưu ảnh/video bằng chứng — toàn bộ dữ liệu chỉ là số liệu (biển số, độ tin cậy, loại xe/vật liệu, cân), lưu trong PostgreSQL.

### python/
- Hai trách nhiệm: `python/detect` (đang chạy — nhận diện) và `python/train` (chưa có script, chỗ dành cho huấn luyện model sau này). Chi tiết: `python/README.md`.
- `python/detect/pipeline.py`: YOLO khoanh vùng biển số → RapidOCR đọc ký tự → gom theo xe (track) → phân loại loại xe (COCO) và vật liệu (model riêng hoặc CLIP zero-shot tạm thời). Nhận cả đường dẫn file video lẫn URL luồng (RTSP) làm input, vì `cv2.VideoCapture` xử lý như nhau.
- Không có HTTP server, không phụ thuộc NestJS. Chạy độc lập bằng CLI (`python python/detect/pipeline.py <nguồn> <cameraId>`); mỗi lượt xác nhận in ra một dòng JSON ở stdout. Đặt `GATE_API_URL` để nó tự `POST` từng lượt sang `apps/api`.
- Model `.pt` đặt ở `python/models/` (không commit, tải bằng `python/scripts/download-models.sh`).

### apps/api/
- NestJS, 2 module chính: `GateModule` (gate passes, master data, Telegram) và `PrismaModule`.
- `GateController` nhận lượt nhận diện qua `POST /api/gate/detections` (gọi bởi `python/detect`) và số liệu cân qua `POST /api/gate/weighbridge/readings` (gọi bởi trạm cân ngoài hoặc cân giả lập). `GatePassesService` ghép hai nguồn theo biển số + thời gian, chạy kiểm tra chéo (`gate.verification.ts`), đọc/ghi qua `GatePassRepository`/`WeighReadingRepository` (Postgres qua Prisma). `MasterDataService` quản lý xe/tài xế — cũng đọc/ghi Postgres.
- `TelegramService` gửi báo cáo ngày theo yêu cầu, và từ khi có `AssistantService` còn chạy một vòng long-poll (`getUpdates`) nền để nhận tin nhắn admin chat trực tiếp với bot: câu hỏi tự do (không phải `/start`, `/reset`) được chuyển cho `AssistantService`, gọi Claude (Anthropic Messages API) với bộ "tool" đọc dữ liệu thật (`get_passes_summary`, `list_passes`, `list_vehicles`) rồi trả lời lại qua Telegram. Cần `ANTHROPIC_API_KEY`; thiếu thì bot báo "chưa cấu hình" thay vì lỗi. Xem `apps/api/src/gate/assistant.service.ts`.
- Không còn module xử lý video upload (`VideosModule`/`videos.service.ts`) và không serve file tĩnh (`/storage`) — hai thứ này đã xoá cùng lúc bỏ lưu ảnh/video.
- Package name: `@camera-ai/api`.

### apps/dashboard/
- React 19 + Vite + TanStack Query, dev server tại `http://localhost:5173`.
- Gọi `apps/api` qua HTTP (REST, polling + SSE cho realtime), không gọi trực tiếp Python hay Postgres.
- 4 menu chính (khớp proposal): Trạm cân trực tiếp, Xác nhận vật liệu, Sổ cân & truy vết, Điều hành ba cơ sở (gồm cả danh mục xe/tài xế). Cài đặt Telegram là mục phụ ở chân sidebar.
- Package name: `@camera-ai/dashboard`.

## Giao tiếp giữa các lớp

```text
python/detect  --HTTP POST /api/gate/detections-->  apps/api
trạm cân ngoài --HTTP POST /api/gate/weighbridge/readings--> apps/api
apps/api       --Prisma Client--> PostgreSQL
apps/dashboard --HTTP (REST + SSE)--> apps/api
```

Ba lớp không phụ thuộc runtime lẫn nhau — `apps/api` không spawn hay quản lý tiến trình `python/detect` (khác bản cũ: trước đây NestJS `spawn` một tiến trình Python cho mỗi video upload). Mỗi lớp chạy độc lập; `python/detect` chỉ cần biết URL của `apps/api` để đẩy dữ liệu sang.

## Lưu trữ dữ liệu

- **PostgreSQL qua Prisma** (`apps/api/prisma/schema.prisma`, client ở `apps/api/src/prisma/`) là nguồn dữ liệu duy nhất cho: `Vehicle`/`Driver` (master data), `GatePass`/`WeighReading` (state cổng + lượt cân), `TelegramConfig`.
- Pattern trong `GatePass`: cột thường (plateNormalized, status, visitStatus, resolution, capturedAt) có index để lọc/sắp xếp nhanh; phần nghiệp vụ lồng nhau (lượt nhận diện vào/ra, chi tiết kiểm tra chéo, nhật ký) lưu dạng JSONB, giữ nguyên hình dạng TypeScript đã định nghĩa ở `gate.types.ts`.
- Không có file tĩnh nào được lưu hay serve — không `storage/uploads`, không `storage/results`, không ảnh/video bằng chứng. Mọi bằng chứng là số liệu (độ tin cậy OCR/detector, thời điểm, biển số).
- Local dev dùng `docker-compose.yml` ở root để chạy Postgres (`postgres:16-alpine`, port host `5433`).

## Chạy local

```bash
docker compose up -d        # Postgres cho dev, cổng host 5433
pnpm install
pnpm dev                    # chạy song song apps/api (NestJS) + apps/dashboard (Vite)
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:4000` (prefix `/api`)
- Python chạy tách biệt, không nằm trong `pnpm dev` (không phải package Node): cài đặt và lệnh chạy xem `python/README.md`. Đây đúng ý "chạy chung hoặc chạy riêng" — `pnpm dev` luôn chạy được mà không cần python, và python luôn chạy độc lập được mà không cần NestJS đang bật (chỉ cần nếu muốn đẩy kết quả sang thì bật `GATE_API_URL`).
- Biến môi trường: xem `.env.example` (DB connection string cho Prisma, `CORS_ORIGINS`, `WEIGHBRIDGE_*`, `TELEGRAM_*`, các biến `LPR_*`/`MATERIAL_*` cho `python/detect`).
