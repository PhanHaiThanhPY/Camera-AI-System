# python/streamsim — mô phỏng stream camera

Trang web giả lập "4 góc" camera của một cơ sở mà không cần camera/RTSP thật — dùng khi phát
triển/demo `python/detect/pipeline.py`. Khung hình đọc bằng OpenCV ở phía máy chủ rồi phát qua
WebRTC (aiortc), nên phát được trên trình duyệt cho mọi loại nguồn (http/https, rtsp, hay cả file
cục bộ) — không phụ thuộc trình duyệt có hỗ trợ giao thức gốc của link hay không.

## Cài đặt

```bash
python3 -m venv .venv   # bỏ qua nếu đã có .venv chung của repo
.venv/bin/pip install -r python/streamsim/requirements.txt
```

## Chạy

```bash
.venv/bin/python python/streamsim/server.py
# hoặc chỉ định host/port:
.venv/bin/python python/streamsim/server.py --host 127.0.0.1 --port 8800
```

Mở `http://localhost:8800`.

## Cách dùng

1. Chọn cơ sở (Mỏ đá / Mỏ cát / Cơ sở bê tông).
2. Mỗi cơ sở có 4 màn hình ứng với 4 góc camera quen thuộc: C1 toàn cảnh vào, C2 cận cảnh vào, C3 toàn cảnh ra, C4 cận cảnh ra — **mỗi màn hình có ô nhập link và nút Lưu & phát riêng**. Dán link (http/https, rtsp, hoặc đường dẫn file) vào đúng ô, bấm nút của màn hình đó: chỉ camera đó được lưu và kết nối lại, 3 camera còn lại không bị ảnh hưởng.
3. Trang tự mở kết nối WebRTC tới các camera đã có link sẵn khi tải trang, và phát trực tiếp. Mất tín hiệu thì tự thử kết nối lại; chưa mở được nguồn hoặc đang kết nối thì hiện khung báo trạng thái thay vì hình đen. Xoá trắng ô link rồi bấm Lưu & phát để dừng và gỡ camera đó.
4. Link đã lưu dùng thẳng được làm nguồn cho pipeline nhận diện thật:

   ```bash
   python python/detect/pipeline.py <link> <cameraId>
   ```

Link nhập vào được lưu trong `links.json` cạnh file này (không commit vào Git — xem `.gitignore`), còn nguyên khi tải lại trang hoặc khởi động lại server.
