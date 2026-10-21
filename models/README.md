# Models

Chạy `scripts/download-models.sh` để tải:

| File | Dùng để | Nguồn |
|---|---|---|
| `license-plate-detector.pt` | khoanh vùng biển số | Koushim/yolov8-license-plate-detection (MIT) |
| `yolov8n.pt` | phát hiện xe (car/motorcycle/bus/truck) để cắt ảnh xe, ảnh đá | Ultralytics COCO |

Không commit file `.pt`. Đường dẫn đổi qua `LPR_MODEL_PATH`, `VEHICLE_DET_MODEL_PATH`.

Loại đá: chưa có model. Đặt `MATERIAL_MODEL_PATH` trỏ tới model phân loại ảnh (YOLO classify) có tên class trùng mã danh mục (`da_bi`, `da_vuong`, `empty`). Khi chưa có, loại đá để "chưa xác định" cho người vận hành chọn.
