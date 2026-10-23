# Kiểm soát xe tại khu mỏ đá — Bước 1: nghiệp vụ & phạm vi

## Nghiệp vụ
Xe vào/ra cổng → camera chụp biển số → trạm cân ngoài gửi số liệu (gross/tare) → hệ thống ghép hai nguồn, đối chiếu chéo, người vận hành xác nhận hoặc từ chối.

## Trong phạm vi bước 1
- Lượt xe (`GatePass`) ghép từ: biển số nhận diện được + loại xe + loại đá + số liệu cân. Không lưu ảnh/video — chỉ số liệu (xem `python/README.md`).
- Số liệu cân đẩy vào `POST /api/gate/weighbridge/readings` (header `X-Weighbridge-Key` nếu đặt `WEIGHBRIDGE_API_KEY`). Cân 2 lần: mỗi lần gửi một request, chỉ `grossKg` (lần 1, xe + hàng) hoặc `tareKg` (lần 2, xe không), kèm `scaleId, ticketNo?, plateNumber?, measuredAt?`. Lần 2 tự gộp vào lượt xe theo biển số trong `GATE_SECOND_WEIGH_WINDOW_SECONDS` (mặc định 4 giờ); thiếu biển số thì ghép tay.
- Danh mục vật liệu ban đầu theo nghiệp vụ khách hàng: cát, đá 2–3, đá 4–6, đá tảng (+ không chở hàng); mẫu chuẩn từng cơ sở cần được khách hàng xác nhận.
- Lần cân 1 ghép với lượt chụp theo cửa sổ thời gian (`GATE_MATCH_WINDOW_SECONDS`) và độ giống biển số; ghép tay cần lý do.
- Kiểm tra chéo: OCR, loại xe/đá, biển số camera↔phiếu cân (lệch 1 ký tự = cần xem lại), thời gian, net âm/không tải mà có hàng, gross/tare theo loại xe.
- Trạng thái máy: `WAITING_WEIGHT / WAITING_SECOND_WEIGH / VERIFIED / REVIEW_REQUIRED / MISMATCH`; quyết định người: `CONFIRMED / REJECTED`. Từ chối, chỉnh sửa hoặc xác nhận lượt chưa khớp bắt buộc ghi lý do; mọi thao tác vào nhật ký, giá trị AI gốc không bị ghi đè.
- Dữ liệu mẫu không được bật trong API production; có thể tạo lượt qua UI và các endpoint cân thật để kiểm thử từng kịch bản.

## Chưa làm / giả định cần xác nhận
- Chưa có camera thật: nguồn hiện là file video hoặc URL luồng (RTSP) chạy tay qua `python/detect/pipeline.py`, giờ chụp lấy theo giờ server khi có lượt nhận diện (`clockSource: server`).
- Loại xe lấy từ model COCO (car/motorcycle/bus/truck, hay nhầm xe sang với xe tải). Vật liệu: CLIP zero-shot có thể đề xuất cát / đá 2–3 / đá 4–6 / đá tảng từ vùng hàng trên khung hình (nguồn ghi `zero-shot`), người vận hành vẫn sửa được. Cần ảnh vùng hàng được lưu cùng nhãn kiểm duyệt để tạo tập huấn luyện; hiện pipeline không gửi/lưu ảnh và `python/train` chưa có script.
- Bảng khối lượng theo loại xe (`gate.catalog.ts`) là giá trị tạm, cần hiệu chỉnh theo đội xe thực tế.
- Chưa có xác thực người dùng, vào/ra theo cặp vẫn dựa vào biển số + cửa sổ thời gian (không có ID camera theo cặp vào/ra riêng).
- Xe qua camera lần 2 (ra cổng) hiện tạo lượt xe mới, chưa gộp với lượt vào.
- Câu hỏi mở đã chốt: giao thức HTTP, cân 2 lần gross→tare, danh mục đá tạm, không lưu ảnh/video bằng chứng (chỉ số liệu).

## Giao diện
Bốn menu chính theo proposal: **Trạm cân trực tiếp** (`#/live`), **Xác nhận vật liệu** (`#/confirm`), **Sổ cân & truy vết** (`#/table`), **Điều hành ba cơ sở** (`#/ops`, gồm cả danh mục xe/tài xế). Cài đặt Telegram (`#/telegram`) là mục phụ ở chân sidebar.

Dữ liệu lượt xe vào/cập nhật qua SSE (`/api/live/events`) ngay khi `POST /api/gate/detections` nhận được lượt mới. Sổ cân & truy vết có Clear (đã xử lý / tất cả) để dọn bản ghi.

## Pipeline nhận diện (không mô phỏng)
YOLO biển số (`LPR_IMGSZ=1280`) → OCR (phóng to crop nhỏ) → gom theo xe bằng vị trí + thời gian → bình chọn biển số theo độ tin cậy → chọn khung hình tốt nhất để phân loại loại xe và vật liệu. Không cắt/lưu ảnh — chỉ số liệu được đẩy sang `apps/api` (xem `python/README.md`).
- Xe: box từ model COCO chứa tâm biển số; không thấy thì ước lượng từ biển (`VEHICLE_WIDTH_PLATE_RATIO`).
- Vật liệu: chỉ phân loại khi xe được nhận là xe tải; lấy phần trên khung xe (`LOAD_REGION_TOP_FRACTION`), heuristic, cần chỉnh theo góc camera.
- Biển phải khớp `LPR_PLATE_REGEX` (mặc định biển VN) mới được xác nhận, để loại chữ đọc nhầm từ nền.

## Cân giả lập
Khi `WEIGHBRIDGE_MOCK_RANDOM=true`, hệ thống random cân tại thời điểm chụp biển số (tare 1,0–1,5 tấn, hàng 0,6–1,5 tấn, bước 100 kg) qua đúng đường nhận số liệu cân (gross lần 1, tare lần 2). Biến này mặc định tắt và chỉ nên bật để demo; khi nối trạm cân thật, giữ là `false`.

## Master data (xe và tài xế)
- Lưu trong PostgreSQL (bảng `Vehicle`/`Driver`, qua Prisma): danh sách xe trong bãi, mỗi xe có nhiều tài xế (một tài xế chính). API `/api/master/vehicles` (GET/POST/PATCH/DELETE), `/api/master/vehicles/:id/drivers`, `/api/master/drivers/:id`, `POST /api/master/vehicles/import-captured` (nhập biển đã chụp). Xoá xe thì xoá luôn tài xế của xe đó.
- Mỗi lần quét, biển số được đối chiếu với danh sách xe: khớp → hiện tài xế của xe; lệch 1 ký tự → "cần xem lại" (nghi OCR đọc nhầm); không có → trạng thái **Không tìm thấy xe ở bãi** (`NOT_IN_YARD`). Sửa master data thì các lượt đã quét được đối chiếu lại.
- Danh sách lượt xe và cân giờ lưu trong PostgreSQL (bảng `GatePass`/`WeighReading`, qua Prisma), không mất khi khởi động lại API.

## Báo cáo Telegram
Menu **Telegram**: dán token bot (từ @BotFather), add bot vào nhóm, bấm Tìm nhóm để chọn nhóm nhận báo cáo, gửi tin thử. Chọn ngày → Xem trước → Gửi báo cáo. Token lưu trong PostgreSQL (bảng `TelegramConfig`, qua Prisma; không trả về trình duyệt; có thể đặt bằng `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`).
Báo cáo gồm: tóm tắt (tổng lượt, tổng khối lượng, kết quả kiểm tra, xử lý, theo loại đá), danh sách **cần chú ý** kèm lý do, bảng chi tiết từng lượt; dài thì tự chia nhiều tin (giới hạn 4096 ký tự của Telegram). API: `GET/PUT/DELETE /api/telegram/config`, `GET /api/telegram/chats`, `POST /api/telegram/test`, `GET /api/telegram/report/preview?date=`, `POST /api/telegram/report {date}`.

### Trợ lý AI (hỏi đáp tự do)
Ngoài báo cáo theo lịch, admin có thể **chat trực tiếp với bot** (không cần qua nhóm) để hỏi tự do về dữ liệu hệ thống — "hôm nay có bao nhiêu xe vào ra", "tổng khối lượng tuần này", "xe 51C-12345 của ai lái". `TelegramService` chạy một vòng long-poll (`getUpdates`) nền nhận tin nhắn, chuyển cho `AssistantService` gọi Claude kèm 3 công cụ đọc dữ liệu thật (`get_passes_summary`, `list_passes`, `list_vehicles` — không tự bịa số). Cần đặt `ANTHROPIC_API_KEY`; thiếu thì bot trả lời "chưa cấu hình" thay vì lỗi. `/start` xem hướng dẫn, `/reset` xoá ngữ cảnh hội thoại. Mặc định bot trả lời mọi chat đã nhắn tin cho nó; giới hạn bằng `TELEGRAM_ASSISTANT_ALLOWED_CHAT_IDS` (danh sách chat ID, cách nhau dấu phẩy) nếu cần hạn chế người được hỏi.

## Vòng vào/ra (visitStatus)
Một lượt xe giờ có `visitStatus` riêng, tách khỏi `status` (status là kết quả kiểm tra chéo):
- `ENTERED` — đã có **cân đầu vào** (một trong hai: gross hoặc tare), xe đang trong bãi chờ cân khi ra.
- `EXITED` — đã có cả **cân đầu vào** và **cân đầu ra**, lượt khép kín; `netKg` = cân ra − cân vào = khối lượng đá chở ra (không phụ thuộc field nào đến trước — hệ thống lấy theo *thời điểm*, không theo tên field gross/tare, nên vẫn đúng cho cả chiều ngược lại: xe chở hàng đến cân đầy lúc vào rồi cân rỗng lúc ra).
- `null` — chưa có lần cân nào.

**Xe cân lại sau khi đã ENTERED+EXITED**: `ingestReading` chỉ ghép số liệu cân mới vào một lượt đang PENDING và chưa EXITED (đang mở). Nếu không còn lượt nào đang mở cho biển đó — kể cả vì lượt trước đã ra xong — hệ thống tự tạo **một lượt mới** (`createFromReading`), dùng chính số liệu cân đó làm cân đầu vào. Lượt mới này không qua nhận diện biển số (`capture.source: "weighbridge"`) trừ khi sau đó camera nhận diện được biển số và python ghép vào (hiện tại ghép theo luồng nhận diện riêng, không tự động nối với lượt tạo từ cân — hai nguồn vẫn độc lập).
