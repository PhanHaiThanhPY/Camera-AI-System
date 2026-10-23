# python/ — nhận diện biển số & phân loại vật liệu

Lớp AI của hệ thống. Hai trách nhiệm:

```text
python/detect   nhận dữ liệu từ video/luồng camera, chạy model, đẩy kết quả cho apps/api
python/train    (chưa có script) nơi đặt notebook/script huấn luyện lại model sau này
python/models   file .pt (không commit — tải bằng python/scripts/download-models.sh)
```

## Chạy độc lập

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
python/scripts/download-models.sh

# File video test
.venv/bin/python python/detect/pipeline.py path/to/video.mp4 cam-01

# Luồng RTSP thật (cv2.VideoCapture nhận URL luồng y như file)
.venv/bin/python python/detect/pipeline.py rtsp://user:pass@host/stream cam-01
```

Mỗi lượt xe được xác nhận in ra một dòng JSON ở stdout (`cameraId`, `trackId`, `plateNumber`,
`ocrConfidence`, `detectorConfidence`, `vehicleType`, `material`, `final`) — không có ảnh, chỉ số
liệu. Đặt `GATE_API_URL` (ví dụ `http://localhost:4000/api`) để script tự POST từng lượt tới
`apps/api` (`POST /gate/detections`) thay vì chỉ in ra màn hình.

## Cấu hình

Biến môi trường cho `pipeline.py` nằm trong `.env.example` ở gốc repo (nhóm `LPR_*`,
`VEHICLE_*`, `MATERIAL_*`). Model biển số/xe/vật liệu lấy từ `python/models/`, xem
`python/models/README.md`.

## Quan hệ với apps/api

`pipeline.py` không phụ thuộc NestJS — chạy được hoàn toàn độc lập (ví dụ để thử nghiệm model).
Khi `GATE_API_URL` được đặt, nó gọi HTTP sang `apps/api`; đó là điểm nối duy nhất giữa hai lớp.
`apps/api` không spawn hay quản lý tiến trình Python nữa (khác bản cũ dùng `services/ai-worker`
qua subprocess) — chạy `pipeline.py` là việc của hạ tầng triển khai (systemd/cron/container riêng).
