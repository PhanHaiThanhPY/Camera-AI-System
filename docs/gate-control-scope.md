# Kiểm soát xe tại khu mỏ đá — Bước 1: nghiệp vụ & phạm vi

## Nghiệp vụ
Xe lên trạm cân → trạm cân gửi số liệu (gross/tare) → hệ thống yêu cầu camera chụp ngay (cân-trước-chụp-sau: xe đứng yên trên cân lúc này nên ảnh nét nhất, và đúng lúc camera CẦN chụp — không chạy AI liên tục lúc xe chưa lên cân) → camera trả biển số/loại xe/loại đá → hệ thống đối chiếu chéo, người vận hành xác nhận hoặc từ chối.

## Trong phạm vi bước 1
- Lượt xe (`GatePass`) ghép từ: số liệu cân + biển số/loại xe/loại đá nhận diện được sau khi chụp, kèm ảnh bằng chứng (crop vùng xe, lưu trên MinIO — xem `python/README.md`).
- Số liệu cân đẩy vào `POST /api/gate/weighbridge/readings` (header `X-Weighbridge-Key` nếu đặt `WEIGHBRIDGE_API_KEY`). Cân 2 lần: mỗi lần gửi một request, chỉ `grossKg` (xe + hàng) hoặc `tareKg` (xe không), kèm `scaleId, ticketNo?, measuredAt?` — **không cần `plateNumber`**, vì lúc cân chưa biết biển số (biển số chỉ có sau khi camera chụp). Mỗi lần nhận được số liệu, hệ thống mở ngay một đợt chờ ảnh (xem "Pipeline nhận diện" bên dưới); lần cân thứ hai ghép vào đúng lượt xe **theo trạm cân** (`scaleId`), trong `GATE_MATCH_WINDOW_SECONDS` kể từ lần cân gần nhất của trạm đó — không theo biển số như trước. Hạn chế đã biết: một trạm cân chỉ phân biệt được xe theo thời gian, nên 2 xe khác nhau cân cách nhau quá lâu trên cùng trạm (hơn `GATE_MATCH_WINDOW_SECONDS`) sẽ tạo 2 lượt riêng dù có thể là cùng 1 xe quay lại — chấp nhận được vì chưa có biển số để phân biệt chắc hơn.
- Danh mục vật liệu ban đầu theo nghiệp vụ khách hàng: cát, đá 2–3, đá 4–6, đá tảng (+ không chở hàng); mẫu chuẩn từng cơ sở cần được khách hàng xác nhận.
- Kiểm tra chéo: OCR, loại xe/đá, biển số camera↔phiếu cân (lệch 1 ký tự = cần xem lại), thời gian, net âm/không tải mà có hàng, gross/tare theo loại xe.
- Trạng thái máy: `WAITING_CAPTURE` (đã cân, đang chờ ảnh) `/ WAITING_WEIGHT / WAITING_SECOND_WEIGH / VERIFIED / REVIEW_REQUIRED / MISMATCH / CAPTURE_FAILED` (hết giờ chờ mà không camera nào đọc được biển — ảnh mờ hoặc không thấy biển, cần người kiểm tra lại); quyết định người: `CONFIRMED / REJECTED`. Từ chối, chỉnh sửa hoặc xác nhận lượt chưa khớp bắt buộc ghi lý do; mọi thao tác vào nhật ký, giá trị AI gốc không bị ghi đè.
- Dữ liệu mẫu không được bật trong API production (`DEMO_MODE=false`); có thể tạo lượt qua UI (nút "Mô phỏng cân + chụp") và các endpoint cân thật để kiểm thử từng kịch bản.

## Chưa làm / giả định cần xác nhận
- Chưa có camera thật: nguồn hiện là file video hoặc URL luồng (RTSP) chạy tay qua `python/detect/pipeline.py`, giờ chụp lấy theo giờ server khi có lượt nhận diện (`clockSource: server`).
- Loại xe lấy từ model COCO (car/motorcycle/bus/truck, hay nhầm xe sang với xe tải). Vật liệu: CLIP zero-shot có thể đề xuất cát / đá 2–3 / đá 4–6 / đá tảng từ vùng hàng trên khung hình (nguồn ghi `zero-shot`), người vận hành vẫn sửa được. Ảnh bằng chứng hiện lưu là crop quanh vùng xe (không riêng vùng hàng) — muốn dùng để tạo tập huấn luyện vật liệu thì cần ghép thêm nhãn đã kiểm duyệt với đúng crop vùng hàng; `python/train` vẫn chưa có script.
- Bảng khối lượng theo loại xe (`gate.catalog.ts`) là giá trị tạm, cần hiệu chỉnh theo đội xe thực tế.
- Chưa có xác thực người dùng, vào/ra theo cặp vẫn dựa vào biển số + cửa sổ thời gian (không có ID camera theo cặp vào/ra riêng).
- Xe qua camera lần 2 (ra cổng) hiện tạo lượt xe mới, chưa gộp với lượt vào.
- Câu hỏi mở đã chốt: giao thức HTTP, cân 2 lần gross→tare, danh mục đá tạm, ảnh bằng chứng lưu trên MinIO (chỉ link ảnh ghép vào số liệu, không lưu video).

## Giao diện
Bốn menu chính theo proposal: **Trạm cân trực tiếp** (`#/live`), **Xác nhận vật liệu** (`#/confirm`), **Sổ cân & truy vết** (`#/table`), **Điều hành ba cơ sở** (`#/ops`, gồm cả danh mục xe/tài xế). Cài đặt Telegram (`#/telegram`) là mục phụ ở chân sidebar.

Dữ liệu lượt xe vào/cập nhật qua SSE (`/api/live/events`) ngay khi có số liệu cân mới hoặc camera trả kết quả chụp. Sổ cân & truy vết có Clear (đã xử lý / tất cả) để dọn bản ghi.

## Pipeline nhận diện (cân-trước-chụp-sau, không mô phỏng)
Mỗi tiến trình `python/detect/pipeline.py` là 1 camera, giữ kết nối video/RTSP sống và polling `GET /api/gate/capture-requests/pending?scaleId=` (mỗi `CAPTURE_POLL_SECONDS`) để biết trạm cân của mình vừa cân xong chưa. Có tín hiệu: lấy khung hình hiện tại, chạy YOLO biển số (`LPR_IMGSZ=1280`) → OCR (phóng to crop nhỏ) **một lần** trên đúng khung đó (không gom/bình chọn qua nhiều khung như trước, vì xe đứng yên trên cân) → phân loại loại xe và vật liệu → crop quanh vùng xe, upload MinIO → `POST /api/gate/passes/:id/capture-result`.
- Xe: box từ model COCO chứa tâm biển số; không thấy thì ước lượng từ biển (`VEHICLE_WIDTH_PLATE_RATIO`).
- Vật liệu: chỉ phân loại khi xe được nhận là xe tải; lấy phần trên khung xe (`LOAD_REGION_TOP_FRACTION`), heuristic, cần chỉnh theo góc camera.
- Biển phải khớp `LPR_PLATE_REGEX` (mặc định biển VN) mới được xác nhận, để loại chữ đọc nhầm từ nền.
- **Luôn chụp + lưu ảnh làm bằng chứng, kể cả khi không đọc được biển** — ảnh mờ (Laplacian variance dưới `CAPTURE_BLUR_MIN_VARIANCE`) hoặc OCR/độ tin cậy thấp vẫn upload MinIO và gắn `quality: "blurry"`/`"no_plate"` (không thấy biển số nào trong khung thì chụp cả khung làm bằng chứng, không có vùng xe để khoanh riêng). Mục đích: người vận hành luôn có ảnh thật để kiểm tra lại tay, không chỉ có mỗi cảnh báo suông.
- `apps/api` gộp kết quả từ tối đa `CAPTURE_EXPECTED_SHOTS` camera (mặc định 4 — 4 góc, mỗi góc 1 tiến trình, cùng `CAPTURE_SCALE_ID`) hoặc hết `CAPTURE_TIMEOUT_SECONDS` giây, chọn ảnh có OCR cao nhất làm biển số chính thức. Không camera nào đọc được (toàn `blurry`/`no_plate`) → trạng thái `CAPTURE_FAILED` ("cần kiểm tra lại"), ảnh từng camera (dù mờ/không đọc được) vẫn giữ lại trên dashboard để người vận hành xem và nhập tay biển số/loại xe/loại đá.
- `GATE_API_URL` bắt buộc ở mode này (không như trước — tuỳ chọn), vì không polling được thì không biết lúc nào cần chụp.

## Mô phỏng cân + chụp (demo/kiểm thử, không cần camera/cân thật)
Nút "Mô phỏng cân + chụp" ở menu **Trạm cân trực tiếp** (`POST /api/gate/simulate/weigh-and-capture`) đi qua đúng luồng thật: tự quyết cân vào (tare, xe mới) hay cân ra (gross, khép lượt đang mở trên trạm) giống một xe thật tuần tự đi qua trạm, rồi tự "chụp" 4 lần (ngẫu nhiên loại xe/đá, ~20% toàn bộ hỏng để demo `CAPTURE_FAILED`). Dùng được cả khi `DEMO_MODE=false` (ghi thật vào Postgres) hoặc `true` (bộ nhớ trong, xem `apps/api/src/gate/demo-data.ts` — `DemoSeedService` cũng dùng chính cơ chế này để dựng sẵn vài lượt mẫu lúc khởi động).

`WEIGHBRIDGE_MOCK_RANDOM=true` là cơ chế cân giả lập CŨ, chỉ gắn với luồng continuous-detection cũ (`POST /api/gate/detections`, không còn ai gọi mặc định) — không liên quan tới nút "Mô phỏng cân + chụp" ở trên. Giữ lại cho tương thích, không dùng cho demo mới.

## Master data (xe và tài xế)
- Lưu trong PostgreSQL (bảng `Vehicle`/`Driver`, qua Prisma): danh sách xe trong bãi, mỗi xe có nhiều tài xế (một tài xế chính). API `/api/master/vehicles` (GET/POST/PATCH/DELETE), `/api/master/vehicles/:id/drivers`, `/api/master/drivers/:id`, `POST /api/master/vehicles/import-captured` (nhập biển đã chụp). Xoá xe thì xoá luôn tài xế của xe đó.
- Mỗi lần quét, biển số được đối chiếu với danh sách xe: khớp → hiện tài xế của xe; lệch 1 ký tự → "cần xem lại" (nghi OCR đọc nhầm); không có → trạng thái **Không tìm thấy xe ở bãi** (`NOT_IN_YARD`). Sửa master data thì các lượt đã quét được đối chiếu lại.
- Danh sách lượt xe và cân giờ lưu trong PostgreSQL (bảng `GatePass`/`WeighReading`, qua Prisma), không mất khi khởi động lại API.

## Báo cáo Telegram
Menu **Telegram**: tạo bot qua @BotFather, add bot vào nhóm, bấm Tìm nhóm để xem Chat ID, rồi đặt `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` trong `.env` trên máy chủ API và khởi động lại — token/chat id không còn nhập/lưu qua giao diện (bảo mật: không đi qua trình duyệt, không lưu Postgres). Sau khi cấu hình: gửi tin thử, chọn ngày → Xem trước → Gửi báo cáo.
Báo cáo gồm: tóm tắt (tổng lượt, tổng khối lượng, kết quả kiểm tra, xử lý, theo loại đá), danh sách **cần chú ý** kèm lý do, bảng chi tiết từng lượt; dài thì tự chia nhiều tin (giới hạn 4096 ký tự của Telegram). API: `GET/PUT/DELETE /api/telegram/config`, `GET /api/telegram/chats`, `POST /api/telegram/test`, `GET /api/telegram/report/preview?date=`, `POST /api/telegram/report {date}`.

### Trợ lý AI (hỏi đáp tự do)
Đặt `DEEPSEEK_API_KEY` trong `.env` (lấy tại platform.deepseek.com) để bot nhận câu hỏi tự do, ví dụ "hôm nay bao nhiêu xe", "biển 51C-12345 cân bao nhiêu kg lần gần nhất", "xe nào gắn với tài xế Nguyễn Văn A". Chỉ chat nằm trong `TELEGRAM_ASSISTANT_ALLOWED_CHAT_IDS` (hoặc đúng `TELEGRAM_CHAT_ID` nếu để trống) mới được hỏi — tránh người lạ thêm bot vào nhóm khác tốn tiền API key. Gõ `/reset` để xoá lịch sử hội thoại của chat đó.

Vì DeepSeek là API chat văn bản thuần, nó không có cách nào tự kết nối vào Postgres của hệ thống — và cũng không nên cấp quyền đó cho key của bên thứ ba. Nên mọi câu hỏi đi qua `AssistantService` (`apps/api/src/gate/assistant.service.ts`) theo đúng cơ chế "tool calling" chuẩn (OpenAI-compatible, DeepSeek hỗ trợ sẵn): gửi câu hỏi + danh sách tool kèm mô tả cho DeepSeek; nếu nó cần dữ liệu, nó trả về yêu cầu gọi tool (không tự lấy được) — server này mới thực sự chạy tool đó trên dữ liệu thật (`get_passes_summary`, `list_passes`, `list_vehicles` — đọc qua `GatePassesService`/`MasterDataService`) rồi đưa kết quả về cho DeepSeek viết câu trả lời cuối. Không có cách nào bỏ qua lớp server này mà vẫn trả lời đúng số liệu thật, nhưng nó chỉ là một lớp chuyển tiếp mỏng — không tự quyết định gì, không lưu gì ngoài lịch sử hội thoại tạm trong bộ nhớ.

## Vòng vào/ra (visitStatus)
Một lượt xe giờ có `visitStatus` riêng, tách khỏi `status` (status là kết quả kiểm tra chéo):
- `ENTERED` — đã có **cân đầu vào** (một trong hai: gross hoặc tare), xe đang trong bãi chờ cân khi ra.
- `EXITED` — đã có cả **cân đầu vào** và **cân đầu ra**, lượt khép kín; `netKg` = cân ra − cân vào = khối lượng đá chở ra (không phụ thuộc field nào đến trước — hệ thống lấy theo *thời điểm*, không theo tên field gross/tare, nên vẫn đúng cho cả chiều ngược lại: xe chở hàng đến cân đầy lúc vào rồi cân rỗng lúc ra).
- `null` — chưa có lần cân nào.

**Xe cân lại sau khi đã ENTERED+EXITED**: `ingestReading` (qua `resolvePassForWeighSignal`) chỉ ghép số liệu cân mới vào một lượt đang PENDING, chưa EXITED và cùng `scaleId`, cân lần gần nhất trong `GATE_MATCH_WINDOW_SECONDS`. Không còn lượt nào đang mở khớp — kể cả vì lượt trước đã ra xong, hoặc đã quá cửa sổ thời gian — hệ thống tự tạo **một lượt mới**, dùng chính số liệu cân đó làm cân đầu vào và mở ngay một đợt chờ ảnh (xem "Pipeline nhận diện"). Biển số/loại xe/loại đá của lượt mới luôn đến từ camera SAU khi cân (không còn nhánh "không qua nhận diện biển số" như luồng cân-trước-chụp-sau cũ — trừ khi hết giờ chờ mà không camera nào đọc được, khi đó là `CAPTURE_FAILED` và người vận hành nhập tay).
