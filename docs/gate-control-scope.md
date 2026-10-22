# Kiểm soát xe tại khu mỏ đá — Bước 1: nghiệp vụ & phạm vi

## Nghiệp vụ
Xe vào/ra cổng → camera chụp biển số → trạm cân ngoài gửi số liệu (gross/tare) → hệ thống ghép hai nguồn, đối chiếu chéo, người vận hành xác nhận hoặc từ chối.

## Trong phạm vi bước 1
- Lượt xe (`GatePass`) ghép từ: ảnh camera + biển số + vùng biển số (tứ giác) + loại xe + loại đá + số liệu cân.
- Số liệu cân đẩy vào `POST /api/gate/weighbridge/readings` (header `X-Weighbridge-Key` nếu đặt `WEIGHBRIDGE_API_KEY`). Cân 2 lần: mỗi lần gửi một request, chỉ `grossKg` (lần 1, xe + hàng) hoặc `tareKg` (lần 2, xe không), kèm `scaleId, ticketNo?, plateNumber?, measuredAt?`. Lần 2 tự gộp vào lượt xe theo biển số trong `GATE_SECOND_WEIGH_WINDOW_SECONDS` (mặc định 4 giờ); thiếu biển số thì ghép tay.
- Danh mục tạm để test: loại đá = đá bi, đá vuông (+ không chở hàng); loại xe xem `gate.catalog.ts`.
- Lần cân 1 ghép với lượt chụp theo cửa sổ thời gian (`GATE_MATCH_WINDOW_SECONDS`) và độ giống biển số; ghép tay cần lý do.
- Kiểm tra chéo: OCR, loại xe/đá, biển số camera↔phiếu cân (lệch 1 ký tự = cần xem lại), thời gian, net âm/không tải mà có hàng, gross/tare theo loại xe.
- Trạng thái máy: `WAITING_WEIGHT / WAITING_SECOND_WEIGH / VERIFIED / REVIEW_REQUIRED / MISMATCH`; quyết định người: `CONFIRMED / REJECTED`. Từ chối, chỉnh sửa hoặc xác nhận lượt chưa khớp bắt buộc ghi lý do; mọi thao tác vào nhật ký, giá trị AI gốc không bị ghi đè.
- Dữ liệu mẫu: `POST /api/gate/passes/samples` (6 kịch bản, gồm 1 lượt chờ cân lần 2) đi qua đúng luồng thật.

## Chưa làm / giả định cần xác nhận
- Chưa có camera thật: nguồn là video upload, giờ chụp lấy theo giờ server khi worker xác nhận xe (`clockSource: server`), vị trí trong video ở `mediaTimeSec`.
- Loại xe lấy từ model COCO (car/motorcycle/bus/truck, hay nhầm xe sang với xe tải). Loại đá: CLIP zero-shot ước lượng đá bi / đá vuông từ ảnh vùng hàng (nguồn ghi `zero-shot`), người vận hành vẫn sửa được; cần dữ liệu gán nhãn của mỏ để có model chính xác.
- Bảng khối lượng theo loại xe (`gate.catalog.ts`) là giá trị tạm, cần hiệu chỉnh theo đội xe thực tế.
- Lưu trữ vẫn in-memory; chưa có xác thực người dùng, hash/manifest bằng chứng, vào/ra theo cặp.
- Xe qua camera lần 2 (ra cổng) hiện tạo lượt xe mới, chưa gộp với lượt vào.
- Câu hỏi mở đã chốt: giao thức HTTP, cân 2 lần gross→tare, danh mục đá tạm.

## Giao diện
Hai menu. **Danh sách ảnh đã chụp** (`#/table`): bảng mỗi lượt một dòng, các cột ảnh biển số / xe / đá / toàn cảnh, loại xe, loại đá, cân lần 1, lần 2, net, trạng thái.

**Realtime** (`#/live`): chọn video → upload → worker chạy và đẩy từng xe qua SSE (`/api/live/events`) ngay khi xác nhận; video phát kèm khung biển số đồng bộ theo thời gian. Có Clear (đã xử lý / tất cả) để giảm dung lượng.

## Pipeline nhận diện (không mô phỏng)
YOLO biển số (`LPR_IMGSZ=1280`) → OCR (phóng to crop nhỏ) → gom theo xe bằng vị trí + thời gian → bình chọn biển số theo độ tin cậy → chọn frame tốt nhất → cắt **ảnh biển số, ảnh xe, ảnh đá** từ chính frame đó, kèm ảnh toàn cảnh có khung và tứ giác biển số.
- Xe: box từ model COCO chứa tâm biển số; không thấy thì ước lượng từ biển (`VEHICLE_WIDTH_PLATE_RATIO`).
- Đá: chỉ chụp khi xe được nhận là xe tải; lấy phần trên khung xe (`LOAD_REGION_TOP_FRACTION`), heuristic, cần chỉnh theo góc camera.
- Biển phải khớp `LPR_PLATE_REGEX` (mặc định biển VN) mới được xác nhận, để loại chữ đọc nhầm từ nền.

## Cân giả lập
Mỗi lần chụp được biển số, random cân tại thời điểm đó (tare 1,0–1,5 tấn, hàng 0,6–1,5 tấn, bước 100 kg) qua đúng đường nhận số liệu cân (gross lần 1, tare lần 2). Tắt bằng `WEIGHBRIDGE_MOCK_RANDOM=false` khi nối trạm cân thật.

## Master data (xe và tài xế)
- Lưu ở `storage/master-data.json`: danh sách xe trong bãi, mỗi xe có nhiều tài xế (một tài xế chính). API `/api/master/vehicles` (GET/POST/PATCH/DELETE), `/api/master/vehicles/:id/drivers`, `/api/master/drivers/:id`, `POST /api/master/vehicles/import-captured` (nhập biển đã chụp). Xoá xe thì xoá luôn tài xế của xe đó.
- Mỗi lần quét, biển số được đối chiếu với danh sách xe: khớp → hiện tài xế của xe; lệch 1 ký tự → "cần xem lại" (nghi OCR đọc nhầm); không có → trạng thái **Không tìm thấy xe ở bãi** (`NOT_IN_YARD`). Sửa master data thì các lượt đã quét được đối chiếu lại.
- Danh sách lượt xe và cân giờ lưu ở `storage/gate-state.json`, không mất khi khởi động lại API.

## Báo cáo Telegram
Menu **Telegram**: dán token bot (từ @BotFather), add bot vào nhóm, bấm Tìm nhóm để chọn nhóm nhận báo cáo, gửi tin thử. Chọn ngày → Xem trước → Gửi báo cáo. Token lưu ở `storage/telegram-config.json` (không commit, không trả về trình duyệt; có thể đặt bằng `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`).
Báo cáo gồm: tóm tắt (tổng lượt, tổng khối lượng, kết quả kiểm tra, xử lý, theo loại đá), danh sách **cần chú ý** kèm lý do, bảng chi tiết từng lượt; dài thì tự chia nhiều tin (giới hạn 4096 ký tự của Telegram). API: `GET/PUT/DELETE /api/telegram/config`, `GET /api/telegram/chats`, `POST /api/telegram/test`, `GET /api/telegram/report/preview?date=`, `POST /api/telegram/report {date}`.

## Vòng vào/ra (visitStatus)
Một lượt xe giờ có `visitStatus` riêng, tách khỏi `status` (status là kết quả kiểm tra chéo):
- `ENTERED` — đã có **cân đầu vào** (một trong hai: gross hoặc tare), xe đang trong bãi chờ cân khi ra.
- `EXITED` — đã có cả **cân đầu vào** và **cân đầu ra**, lượt khép kín; `netKg` = cân ra − cân vào = khối lượng đá chở ra (không phụ thuộc field nào đến trước — hệ thống lấy theo *thời điểm*, không theo tên field gross/tare, nên vẫn đúng cho cả chiều ngược lại: xe chở hàng đến cân đầy lúc vào rồi cân rỗng lúc ra).
- `null` — chưa có lần cân nào.

**Xe cân lại sau khi đã ENTERED+EXITED**: `ingestReading` chỉ ghép số liệu cân mới vào một lượt đang PENDING và chưa EXITED (đang mở). Nếu không còn lượt nào đang mở cho biển đó — kể cả vì lượt trước đã ra xong — hệ thống tự tạo **một lượt mới** (`createFromReading`), dùng chính số liệu cân đó làm cân đầu vào. Lượt mới này không có ảnh camera (`capture.source: "weighbridge"`) trừ khi sau đó camera chụp được biển số và video worker ghép vào (hiện tại ghép theo luồng video riêng, không tự động nối với lượt tạo từ cân — hai nguồn capture vẫn độc lập).
