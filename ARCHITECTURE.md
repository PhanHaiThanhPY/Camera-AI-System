# Kiến trúc hệ thống

Bản đồ định hướng cho người mới đọc code lần đầu. Không phải tài liệu API đầy đủ — chi tiết nghiệp vụ xem `docs/gate-control-scope.md`, checklist nối camera thật xem `docs/hikvision-rtsp-deployment.md`.

## 3 lớp

```text
python/           Python — nhận diện biển số/xe/vật liệu từ video hoặc luồng camera, đẩy kết quả
apps/api/         NestJS — nhận kết quả nhận diện, nghiệp vụ cổng (cân, đối soát), master data, Telegram
apps/dashboard/   React 19 + Vite — giao diện vận hành cổng (gate)
```

Số liệu (biển số, độ tin cậy, loại xe/vật liệu, cân) lưu trong PostgreSQL. Ảnh bằng chứng (crop vùng xe lúc nhận diện) lưu trên MinIO (S3-compatible); PostgreSQL chỉ giữ link ảnh.

### python/
- Hai trách nhiệm: `python/detect` (đang chạy — nhận diện) và `python/train` (chưa có script, chỗ dành cho huấn luyện model sau này). Chi tiết: `python/README.md`.
- `python/detect/pipeline.py`: **cân-trước-chụp-sau**, không chạy nhận diện liên tục. Mỗi tiến trình (1 camera) giữ một kết nối video/RTSP sống (`grab()` liên tục, rẻ, không decode) và polling `GET {GATE_API_URL}/gate/capture-requests/pending?scaleId=` để biết trạm cân của mình vừa cân xong chưa. Có tín hiệu: lấy khung hình hiện tại, chạy YOLO khoanh vùng biển số → RapidOCR đọc ký tự → phân loại loại xe (COCO) và vật liệu (model riêng hoặc CLIP zero-shot tạm thời) một lần trên đúng khung đó (không tracking/bình chọn qua nhiều khung như bản cũ, vì xe đứng yên trên cân lúc chụp). Khung hình được crop quanh vùng xe và upload lên MinIO làm ảnh bằng chứng (`python/detect/storage.py`) — bỏ qua nếu chưa đặt `MINIO_ENDPOINT`, không chặn nhận diện. Ảnh mờ (Laplacian variance dưới `CAPTURE_BLUR_MIN_VARIANCE`) hoặc không thấy biển số vẫn báo kết quả nhưng gắn `quality: "blurry"/"no_plate"` để `apps/api` biết.
- Không có HTTP server, không phụ thuộc NestJS khởi động trước, nhưng **bắt buộc** `GATE_API_URL` (khác bản cũ — ở đó tuỳ chọn) vì không polling được thì không biết lúc nào cần chụp. Chạy độc lập bằng CLI (`python python/detect/pipeline.py <nguồn> <cameraId>`); mỗi kết quả in một dòng JSON ở stdout và `POST` tới `{GATE_API_URL}/gate/passes/{passId}/capture-result`. 4 góc camera cùng một trạm cân thì chạy 4 tiến trình, cùng `CAPTURE_SCALE_ID`, `cameraId` khác nhau.
- Model `.pt` đặt ở `python/models/` (không commit, tải bằng `python/scripts/download-models.sh`).
- `python/streamsim`: web mô phỏng "4 góc" camera của một cơ sở khi chưa có camera/RTSP thật — chọn cơ sở, dán link stream cho từng góc (http/https, rtsp, hoặc file), phát qua WebRTC (aiortc + OpenCV đọc khung hình phía máy chủ) nên phát được trên trình duyệt bất kể giao thức gốc của link. Link lưu lại và dùng thẳng được làm nguồn cho `pipeline.py`. Dependency riêng (`python/streamsim/requirements.txt`), không ảnh hưởng `python/detect`. Xem `python/streamsim/README.md`.

### apps/api/
- NestJS, 2 module chính: `GateModule` (gate passes, master data, Telegram) và `PrismaModule`.
- `GateController`: luồng chính (cân-trước-chụp-sau) là `POST /api/gate/weighbridge/readings` (trạm cân ngoài) → `GatePassesService.ingestReading` ghép lượt xe **theo trạm cân** (chưa có biển số lúc này, xem `resolvePassForWeighSignal`) rồi mở ngay một đợt chờ ảnh; `GET /api/gate/capture-requests/pending` và `POST /api/gate/passes/:id/capture-result` là hai điểm nối với `python/detect/pipeline.py` (polling rồi trả kết quả từng camera); `POST /api/gate/simulate/weigh-and-capture` mô phỏng cả chuỗi này (nút "Mô phỏng cân + chụp" ở dashboard). `POST /api/gate/detections` (ghép theo biển số + thời gian, luồng continuous-detection cũ) vẫn còn nhưng không còn ai gọi mặc định — giữ lại cho tương thích. Tất cả chạy qua `gate.verification.ts` (kiểm tra chéo) và đọc/ghi qua `GatePassRepository`/`WeighReadingRepository` (Postgres qua Prisma). `MasterDataService` quản lý xe/tài xế — cũng đọc/ghi Postgres.
- `TelegramService` gửi báo cáo ngày theo yêu cầu, và từ khi có `AssistantService` còn chạy một vòng long-poll (`getUpdates`) nền để nhận tin nhắn admin chat trực tiếp với bot: câu hỏi tự do (không phải `/start`, `/reset`) được chuyển cho `AssistantService`, gọi DeepSeek (Chat Completions API, tương thích OpenAI) với bộ "tool" đọc dữ liệu thật (`get_passes_summary`, `list_passes`, `list_vehicles`) rồi trả lời lại qua Telegram. Cần `DEEPSEEK_API_KEY`; thiếu thì bot báo "chưa cấu hình" thay vì lỗi. Xem `apps/api/src/gate/assistant.service.ts`.
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
- **MinIO** lưu ảnh bằng chứng (crop vùng xe) do `python/detect` upload trực tiếp (xem `python/detect/storage.py`) — `apps/api` không chạm vào MinIO, chỉ nhận lại `imageUrl` qua `POST /gate/detections` và lưu link đó vào `capture`/`exitCapture` (JSONB). `ImageUploader` tự tạo bucket và set quyền đọc công khai theo object (anonymous download, không list) ngay lần khởi động `pipeline.py` đầu tiên — không cần container init riêng — nên dashboard dùng link thẳng, không cần endpoint presign ở `apps/api`. Dev dùng container `minio` trong `docker-compose.yml` (API port `9000`, console `9001`; image chính chủ `minio/minio` đã bị gỡ khỏi Docker Hub/quay.io nên dùng bản build của Chainguard).
- Local dev dùng `docker-compose.yml` ở root để chạy Postgres (`postgres:16-alpine`, port host `5433`) và MinIO.

## Chạy local

```bash
docker compose up -d        # Postgres (cổng host 5433) + MinIO (9000/9001) cho dev
pnpm install
pnpm dev                    # chạy song song apps/api (NestJS) + apps/dashboard (Vite)
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:4000` (prefix `/api`)
- MinIO console: `http://localhost:9001` (đăng nhập bằng `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`)
- Python chạy tách biệt, không nằm trong `pnpm dev` (không phải package Node): cài đặt và lệnh chạy xem `python/README.md`. Đây đúng ý "chạy chung hoặc chạy riêng" — `pnpm dev` luôn chạy được mà không cần python, và python luôn chạy độc lập được mà không cần NestJS đang bật (chỉ cần nếu muốn đẩy kết quả sang thì bật `GATE_API_URL`).
- Biến môi trường: xem `.env.example` (DB connection string cho Prisma, `CORS_ORIGINS`, `WEIGHBRIDGE_*`, `TELEGRAM_*`, các biến `LPR_*`/`MATERIAL_*`/`MINIO_*` cho `python/detect`).
- **`DEMO_MODE=true`** (`.env`, xem `apps/api/src/config/demo-mode.ts`): bỏ qua hoàn toàn Postgres — `PrismaService` không `$connect()`, `GatePassRepository`/`WeighReadingRepository`/`MasterDataService`/`TelegramService` rẽ sang bộ nhớ trong, và `DemoSeedService` (`apps/api/src/gate/demo-seed.service.ts`) dựng sẵn một lô lượt xe mẫu từ `apps/api/src/gate/demo-data.ts` ngay lúc khởi động, đi qua đúng luồng nghiệp vụ thật (`ingestDetection`/`ingestReading`/`resolve`). Dùng để demo dashboard mà chưa cần `docker compose up -d` lẫn camera/cân thật; mặc định `false` chạy luồng thật như trên.

## Đo tải hệ thống

```bash
scripts/measure.sh
```

In nhanh CPU/RAM của tiến trình dev từng lớp (`apps/dashboard`, `apps/api`, `python/detect`, `python/streamsim`), container Postgres + MinIO, và gọi 2 endpoint sức khoẻ:

- `GET /api/health` (apps/api): uptime, RAM tiến trình Node, trạng thái kết nối Postgres.
- `GET /health` (python/streamsim, cổng 8800): số luồng WebRTC đang mở, nguồn từng luồng, luồng nào đang nhận khung hình thật hay chỉ đang thử lại, RAM/CPU tiến trình Python. Lớp `python/streamsim` là nơi tốn tải nhất khi mở nhiều luồng cùng lúc (mỗi luồng là một lần decode + encode riêng) — endpoint này giúp thấy ngay có bao nhiêu luồng đang thật sự chạy khi nghi ngờ máy chịu tải cao.

`scripts/measure.sh` chỉ đọc, không đổi trạng thái gì; chạy được cả khi một vài lớp chưa bật (báo "không chạy"/"không gọi được" thay vì lỗi). Nhận diện được cả tiến trình chạy dev (`pnpm dev`, `nest start --watch`) lẫn production (`pnpm start`, `node dist/src/main.js`) — cùng một script dùng được trên máy dev lẫn trên VPS sau này, không cần bản riêng cho từng môi trường.

Đo trên VPS mà không cần SSH tay vào trước:

```bash
scripts/measure.sh --ssh user@vps-host
```

Lệnh này SSH vào máy đó và chạy đúng `scripts/measure.sh` ở đó (gửi qua stdin, không cần copy file hay cài gì thêm ngoài các lệnh Linux chuẩn: `pgrep`, `ps`, `curl`, và `docker` nếu Postgres/MinIO chạy bằng Docker).

**Lưu ý triển khai production:** `apps/api`'s `pnpm start` chạy `node dist/src/main.js` (đường dẫn build thật của `nest build`, trước đây `package.json` ghi nhầm `dist/main.js` — đã sửa). Trước khi deploy lên VPS, luôn tự kiểm bằng `pnpm build && pnpm start` ở máy dev trước, đừng giả định nó chạy được.
