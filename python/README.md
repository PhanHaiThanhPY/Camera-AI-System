# python/ — nhận diện biển số & phân loại vật liệu

Lớp AI của hệ thống. Hai trách nhiệm:

```text
python/detect      nhận dữ liệu từ video/luồng camera, chạy model, đẩy kết quả cho apps/api
python/train       (chưa có script) nơi đặt notebook/script huấn luyện lại model sau này
python/models      file .pt (không commit — tải bằng python/scripts/download-models.sh)
python/streamsim   web tối giản mô phỏng 4 góc camera (dán link) khi chưa có camera/RTSP thật — xem python/streamsim/README.md
```

## Chạy độc lập

`pipeline.py` chạy theo mô hình **cân-trước-chụp-sau**: mỗi tiến trình (= 1 camera) giữ một kết
nối video/RTSP sống, polling `apps/api` để biết lúc nào trạm cân vừa cân xong — có tín hiệu mới
chụp 1 khung hình hiện tại và chạy nhận diện, không chạy AI liên tục suốt lúc xe chưa lên cân (bản
cũ chạy liên tục suốt video đã bỏ hẳn — xem `docs/gate-control-scope.md`). **Bắt buộc đặt
`GATE_API_URL`** ở mode này (khác bản cũ, ở đó là tuỳ chọn) vì không polling được thì không biết
lúc nào cần chụp.

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
python/scripts/download-models.sh
export GATE_API_URL=http://localhost:4000/api

# File video test, trạm cân SCALE-01 (mặc định CAPTURE_SCALE_ID)
.venv/bin/python python/detect/pipeline.py path/to/video.mp4 cam-01

# Luồng RTSP thật (cv2.VideoCapture nhận URL luồng y như file)
.venv/bin/python python/detect/pipeline.py rtsp://user:pass@host/stream cam-01
```

4 góc camera chụp cùng một trạm cân thì chạy 4 tiến trình riêng (mỗi process 1 camera, như trên),
đặt cùng `CAPTURE_SCALE_ID` (ví dụ cả 4 đều `SCALE-01`) và `cameraId` khác nhau (`cam-front`,
`cam-rear`, `cam-side`, `cam-plate`...) — `apps/api` tự gộp kết quả từ tối đa `CAPTURE_EXPECTED_SHOTS`
camera cho một lượt cân (xem `.env.example`). Chưa có camera thật thì dùng `python/streamsim` dựng
link RTSP giả cho từng góc.

RTSP luôn mở bằng transport TCP mặc định (một số server RTSP chỉ nhận TCP và sẽ treo tới khi hết
timeout mở luồng — mặc định 8s, đổi bằng `LPR_CAPTURE_TIMEOUT_MSEC` — rồi mới báo lỗi thay vì kết
nối nếu ép UDP). Đặt `STREAMSIM_RTSP_TRANSPORT=udp` nếu server của bạn ngược lại chỉ nhận UDP.
Không ảnh hưởng nguồn file/http.

Mỗi kết quả (đọc được hoặc không) in ra một dòng JSON ở stdout (`passId`, `cameraId`, `plateNumber`,
`ocrConfidence`, `detectorConfidence`, `vehicleType`, `material`, `imageUrl`, `quality`:
`ok`/`blurry`/`no_plate`) và POST tới `{GATE_API_URL}/gate/passes/{passId}/capture-result`. `imageUrl`
là link ảnh (crop quanh vùng xe, chỉ có khi `quality: "ok"`) đã upload lên MinIO — `null` nếu chưa
đặt `MINIO_ENDPOINT` (xem `python/detect/storage.py`).

## Cấu hình

Biến môi trường cho `pipeline.py` nằm trong `.env.example` ở gốc repo (`GATE_API_URL`, `CAPTURE_*`
cho luồng cân-trước-chụp-sau; nhóm `LPR_*`, `VEHICLE_*`, `MATERIAL_*`, `MINIO_*` cho nhận diện/ảnh
bằng chứng). Model biển số/xe/vật liệu lấy từ `python/models/`, xem `python/models/README.md`.

## Quan hệ với apps/api

`pipeline.py` chạy độc lập (không phụ thuộc NestJS khởi động trước) nhưng cần `apps/api` đang chạy
và `GATE_API_URL` đúng để polling tín hiệu cân — đây là điểm nối hai chiều giữa hai lớp: pipeline.py
polling `GET /gate/capture-requests/pending` rồi POST `/gate/passes/:id/capture-result` (xem
`apps/api/src/gate/gate.controller.ts`). `apps/api` không spawn hay quản lý tiến trình Python
(khác bản cũ dùng `services/ai-worker` qua subprocess) — chạy `pipeline.py` là việc của hạ tầng
triển khai (systemd/cron/container riêng, 1 tiến trình/camera).
