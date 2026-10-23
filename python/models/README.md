# Models

Chạy `python/scripts/download-models.sh` để tải:

| File | Dùng để | Nguồn |
|---|---|---|
| `license-plate-detector.pt` | khoanh vùng biển số | Koushim/yolov8-license-plate-detection (MIT) |
| `yolov8n.pt` | phát hiện xe (car/motorcycle/bus/truck) để xác định vùng hàng | Ultralytics COCO |

Không commit file `.pt`. Đường dẫn đổi qua `LPR_MODEL_PATH`, `VEHICLE_DET_MODEL_PATH`.

Loại vật liệu: chưa có model huấn luyện riêng (xem `python/train/README.md`). Có thể bật CLIP zero-shot (`MATERIAL_ZERO_SHOT=true`, dùng `openai/clip-vit-base-patch32`, tải tự động lần đầu) để đề xuất cát / đá 2–3 / đá 4–6 / đá tảng / không chở hàng từ vùng hàng trên khung hình. Tính năng này làm quá trình nhận diện chậm hơn, nên đang tắt mặc định. Đây chỉ là ước lượng theo hình dạng nhìn thấy; độ tin cậy dưới `MATERIAL_MIN_CONF` (0,5) thì để "chưa xác định". Khi có model huấn luyện trên dữ liệu đã được khách hàng gán nhãn: đặt `MATERIAL_MODEL_PATH` (YOLO classify, tên class trùng `sand`, `stone_2_3`, `stone_4_6`, `boulder`, `empty`), model này được ưu tiên.
