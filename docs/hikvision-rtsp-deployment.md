# Checklist triển khai camera Hikvision qua RTSP

Tài liệu này là checklist chuẩn bị để kết nối camera Hikvision vào Camera AI System. Bản source hiện tại mới xử lý video upload; phần đọc RTSP liên tục cần được bổ sung theo kiến trúc ở cuối tài liệu.

## 1. Thông tin cần thu thập

| Thông tin | Giá trị cần điền |
|---|---|
| Model camera hoặc NVR | `________________` |
| Camera nối trực tiếp hay qua NVR | `________________` |
| IP camera/NVR | `________________` |
| RTSP port | `554` hoặc `________________` |
| Kênh camera trên NVR | `________________` |
| Username xem camera | `________________` |
| Vị trí lắp đặt | `________________` |
| Số làn xe | `________________` |
| Độ phân giải stream | `________________` |
| Máy chủ chạy AI | `________________` |

Không ghi mật khẩu thật vào tài liệu, Git hoặc tin nhắn. Tạo một tài khoản camera riêng chỉ có quyền xem stream.

## 2. Cấu hình trên Hikvision

### Camera IP

1. Đặt IP tĩnh hoặc DHCP reservation cho camera.
2. Đăng nhập giao diện web của camera.
3. Vào `Configuration → Network → Advanced Settings → Network Service → RTSP`.
4. Bật RTSP và kiểm tra port.
5. Tạo tài khoản chỉ đọc dành riêng cho hệ thống AI.
6. Chọn H.264 cho main stream nếu máy chủ chưa xác nhận hỗ trợ H.265.
7. Bật WDR/IR phù hợp với vị trí ban ngày và ban đêm.
8. Đồng bộ thời gian camera bằng NTP.

### Camera nối qua NVR

Nếu camera đi qua đầu ghi, dùng IP của NVR và số kênh tương ứng. Không dùng IP camera riêng nếu máy chủ AI không truy cập trực tiếp được camera đó.

## 3. RTSP URL

### Main stream kênh 1

```text
rtsp://USERNAME:PASSWORD@CAMERA_IP:554/Streaming/Channels/101
```

### Sub stream kênh 1

```text
rtsp://USERNAME:PASSWORD@CAMERA_IP:554/Streaming/Channels/102
```

Quy ước thường dùng:

- `101`: main stream của kênh 1.
- `102`: sub stream của kênh 1.
- `201`: main stream của kênh 2.
- `202`: sub stream của kênh 2.

Nếu mật khẩu có ký tự đặc biệt như `@`, `#`, `:`, `/` hoặc khoảng trắng, cần URL-encode trước khi đưa vào RTSP URL.

## 4. Kiểm tra trước khi tích hợp source

### Kiểm tra bằng VLC

1. Mở VLC.
2. Chọn `Media → Open Network Stream`.
3. Dán RTSP URL.
4. Xác nhận video hiển thị ổn định tối thiểu 5 phút.

### Kiểm tra bằng FFmpeg

Không ghi password thật vào shell history trên máy dùng chung.

```bash
ffprobe -rtsp_transport tcp "rtsp://USERNAME:PASSWORD@CAMERA_IP:554/Streaming/Channels/101"
```

Đạt yêu cầu khi đọc được codec, độ phân giải, FPS và thời lượng stream mà không bị timeout.

### Kiểm tra mạng

Máy chủ AI phải truy cập được camera:

```bash
ping CAMERA_IP
nc -vz CAMERA_IP 554
```

Chỉ mở chiều kết nối từ máy chủ AI đến camera trong LAN/VLAN. Không port-forward RTSP camera trực tiếp ra Internet.

## 5. Cấu hình hình ảnh khuyến nghị ban đầu

Đây là giá trị khởi đầu để kiểm thử, cần hiệu chỉnh theo vị trí thực tế:

| Cấu hình | Khuyến nghị |
|---|---|
| Codec | H.264 |
| Main stream | Dùng cho AI nhận diện |
| Sub stream | Dùng để xem preview khi cần giảm tải |
| FPS | 15–25 FPS |
| Độ phân giải | Tối thiểu 1920×1080 |
| Shutter | Đủ nhanh để biển số không bị nhòe khi xe di chuyển |
| WDR | Bật nếu có ngược sáng |
| IR | Kiểm tra không làm cháy sáng biển số ban đêm |
| Góc camera | Gần chính diện làn xe, hạn chế góc xiên |

Camera phải được căn sao cho biển số chiếm đủ số pixel trong frame. Model tốt không thể bù cho biển số quá nhỏ, rung, phản sáng hoặc bị che.

## 6. Phần cần bổ sung vào source hiện tại

Source hiện tại chưa đọc RTSP liên tục. Cần thêm một `Camera Capture Service` trước AI worker:

```text
Hikvision RTSP
      ↓
Camera Capture Service
      ↓
Reconnect + frame buffer
      ↓
LPR Worker hiện tại
      ↓
GatePass / Database
      ↓
Dashboard realtime
```

Các chức năng cần triển khai:

- Lưu cấu hình camera trong environment hoặc database.
- Kết nối RTSP bằng OpenCV/FFmpeg.
- Tự reconnect khi camera mất mạng.
- Giới hạn số frame đưa vào AI worker.
- Theo dõi trạng thái `ONLINE / OFFLINE / RECONNECTING`.
- Ghi log lỗi camera.
- Chụp ảnh bằng chứng khi biển số được xác nhận.
- Không để lỗi một camera làm dừng toàn bộ API.
- Có nút Start/Stop camera trong giao diện.
- Có API kiểm tra trạng thái camera.

Cấu hình dự kiến, chỉ dùng sau khi phần camera service được triển khai:

```env
CAMERA_ENABLED=false
CAMERA_ID=gate-01
CAMERA_RTSP_URL=rtsp://USERNAME:PASSWORD@CAMERA_IP:554/Streaming/Channels/101
CAMERA_RTSP_TRANSPORT=tcp
CAMERA_RECONNECT_SECONDS=5
CAMERA_SAMPLE_SECONDS=0.5
```

Không bật `CAMERA_ENABLED=true` trước khi URL đã được kiểm tra bằng VLC/FFmpeg và source đã có camera service tương ứng.

## 7. Máy chủ chạy thực tế

Tối thiểu nên có:

- Ubuntu Server hoặc máy Linux ổn định.
- Node.js 20+.
- Python 3.11+.
- FFmpeg.
- RAM từ 16 GB cho một camera thử nghiệm.
- SSD để lưu ảnh/video.
- GPU NVIDIA nếu cần xử lý gần realtime hoặc nhiều camera.
- UPS cho máy chủ, switch PoE và camera.
- NTP cho máy chủ, camera, NVR và trạm cân.

Khi chạy production nên bổ sung:

- Docker Compose hoặc systemd để tự khởi động lại service.
- PostgreSQL thay cho JSON/memory.
- Redis/BullMQ cho hàng đợi frame/job.
- Object storage cho video và ảnh bằng chứng.
- HTTPS, đăng nhập và phân quyền.
- Backup tự động.
- Chính sách xoá video/ảnh cũ.
- Monitoring CPU, GPU, disk, camera và worker.

## 8. Kiểm thử nghiệm thu

Chỉ đưa vào vận hành sau khi kiểm tra đủ các tình huống:

- Camera mất mạng rồi tự kết nối lại.
- NVR khởi động lại.
- Xe chạy ban ngày và ban đêm.
- Ngược sáng, mưa, biển số bẩn hoặc bị nghiêng.
- Hai xe liên tiếp đi qua.
- Một xe xuất hiện nhiều lần trong cùng stream.
- Không đọc được biển số.
- OCR đọc sai một ký tự.
- Worker bị dừng giữa chừng.
- Ổ đĩa gần đầy.
- Người vận hành cần xác nhận hoặc từ chối kết quả.

Giai đoạn đầu nên chạy song song với nhân viên và chưa tự động mở barie. Khi tỷ lệ đọc đúng và cơ chế xử lý lỗi đạt yêu cầu mới kết nối barie thật.

## 9. Thông tin cần gửi để bắt đầu tích hợp

Gửi các thông tin sau, không gửi mật khẩu:

1. Model Hikvision.
2. Camera nối trực tiếp hay qua NVR.
3. IP nội bộ của camera/NVR.
4. Số kênh nếu đi qua NVR.
5. Ảnh vị trí camera nhìn vào làn xe.
6. Máy chủ AI chạy cùng mạng hay khác mạng.

Sau khi có các thông tin này, bước tiếp theo là tạo camera service, thêm cấu hình RTSP và cho dashboard hiển thị trạng thái camera.
