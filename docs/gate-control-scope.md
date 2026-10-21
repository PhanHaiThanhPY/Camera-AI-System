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
- Loại xe lấy từ model COCO (car/motorcycle/bus/truck, hay nhầm xe sang với xe tải). Loại đá chưa có model, cần dữ liệu gán nhãn của mỏ; hiện để người vận hành chọn.
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
