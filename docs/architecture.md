# Kiến trúc MVP

## Luồng dữ liệu

```text
Browser
  POST multipart/form-data
        ↓
NestJS VideosController
  lưu video vào storage/uploads
  tạo VideoJob
        ↓ spawn
Python worker
  ffprobe metadata
  ffmpeg snapshot + evidence video
  LPR adapter (demo hiện tại)
        ↓ JSON stdout
NestJS VideosService
  cập nhật job
        ↓ polling
React + TanStack Query
```

## Quyết định giai đoạn đầu

- Job lưu trong memory để giảm thời gian dựng demo; mất khi restart API.
- File lưu local để dễ trình diễn tại một máy.
- HTTP polling được dùng cho trạng thái; WebSocket/queue sẽ thêm sau khi luồng nghiệp vụ ổn định.
- Worker không giả vờ nhận diện thật: demo result được đánh dấu `evidenceMode: "demo"`.

## Ranh giới mở rộng

- `VideosService` là nơi thay memory store bằng repository PostgreSQL.
- `runWorker` là nơi thay process trực tiếp bằng BullMQ worker.
- `services/ai-worker/worker.py` đã có adapter detector YOLO + RapidOCR; chỉ cần cung cấp model biển số qua `LPR_MODEL_PATH`.
- URL `/storage` sẽ chuyển sang MinIO/S3 khi triển khai nhiều node.

