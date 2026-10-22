# Models

Chạy `scripts/download-models.sh` để tải:

| File | Dùng để | Nguồn |
|---|---|---|
| `license-plate-detector.pt` | khoanh vùng biển số | Koushim/yolov8-license-plate-detection (MIT) |
| `yolov8n.pt` | phát hiện xe (car/motorcycle/bus/truck) để cắt ảnh xe, ảnh đá | Ultralytics COCO |

Không commit file `.pt`. Đường dẫn đổi qua `LPR_MODEL_PATH`, `VEHICLE_DET_MODEL_PATH`.

Loại đá: chưa có model huấn luyện riêng. Có thể bật CLIP zero-shot (`MATERIAL_ZERO_SHOT=true`, dùng `openai/clip-vit-base-patch32`, tải tự động lần đầu) để ước lượng đá bi / đá vuông / không chở hàng từ ảnh vùng hàng. Tính năng này làm worker khởi động và xử lý chậm hơn, nên đang tắt mặc định. Đây chỉ là ước lượng theo hình dạng và kích cỡ hạt đá; độ tin cậy dưới `MATERIAL_MIN_CONF` (0,5) thì để "chưa xác định". Nếu ảnh vùng hàng thực ra là xe con (model xe nhận nhầm), ảnh bị bỏ. Khi có model huấn luyện trên ảnh của mỏ: đặt `MATERIAL_MODEL_PATH` (YOLO classify, tên class trùng `da_bi`, `da_vuong`, `empty`), model này được ưu tiên.
