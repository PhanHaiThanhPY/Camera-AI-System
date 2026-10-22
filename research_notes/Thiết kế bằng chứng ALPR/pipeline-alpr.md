# Thiết kế pipeline và bằng chứng ALPR trong video

> Ghi chú nghiên cứu kỹ thuật — cập nhật 21/10/2026.  
> Phạm vi: nhận dạng biển số tự động (ALPR/LPR/ANPR) trên video và thiết kế evidence capture có thể truy vết, kiểm tra lại và tái hiện.

## 1. Kết luận ngắn

Pipeline video ALPR nên được thiết kế theo đơn vị **track/event của một phương tiện**, không phải theo từng frame độc lập:

```text
video/RTSP
  -> lấy mẫu frame + đồng bộ thời gian
  -> phát hiện xe/biển số (detection box + score)
  -> tracking (track_id, trajectory, trạng thái occlusion)
  -> crop/chuẩn hoá biển số
  -> OCR/recognition trên nhiều frame
  -> chọn best frame + tổng hợp kết quả theo track
  -> xác nhận event / chống trùng
  -> lưu evidence: ảnh toàn cảnh, crop biển số, metadata, clip ngắn
  -> video annotated để audit/debug
```

Ba nguyên tắc quan trọng:

1. **Tách các loại confidence**: detection confidence, OCR/plate confidence và tracker confidence không phải cùng một đại lượng. NVIDIA DeepStream hiện tách bbox của detector và tracker, đồng thời tách `confidence` của inference khỏi `tracker_confidence` của tracker. [NVIDIA — DeepStream metadata](https://docs.nvidia.com/metropolis/deepstream/7.1/text/DS_plugin_metadata.html)
2. **Không chốt biển số từ một frame đầu tiên**. Plate Recognizer Stream giữ prediction trong một khoảng `max_prediction_delay` để có thêm quan sát và chọn frame tốt hơn; output còn có ảnh chụp, crop/ảnh xe, timestamp và video clip. [Plate Recognizer — configuration](https://guides.platerecognizer.com/docs/stream/configuration/), [FAQ](https://guides.platerecognizer.com/docs/stream/help/faq/)
3. **Evidence phải giữ liên kết hai chiều**: event -> best frame/crop/clip và event -> toàn bộ các observation trong track. Khi kết quả bị khiếu nại, chỉ một chuỗi text cuối cùng là không đủ để chứng minh hệ thống đã nhìn thấy gì.

## 2. Những gì các nguồn chính thống cho thấy

### 2.1. Detection box và confidence

- Plate Recognizer trả về box biển số với `xmin`, `ymin`, `xmax`, `ymax`; ví dụ output còn có `plate`, danh sách `candidates`, `score`, `vehicle.box`, `position_sec` và đường dẫn nguồn video. [Webhooks and Output formats](https://guides.platerecognizer.com/docs/stream/results/)
- DeepStream lưu riêng `detector_bbox_info`, `tracker_bbox_info` và bbox dùng cho hiển thị. `confidence` là confidence từ inference; `tracker_confidence` là confidence của tracker có khả năng visual tracking (ví dụ NvDCF). [DeepStream metadata](https://docs.nvidia.com/metropolis/deepstream/7.1/text/DS_plugin_metadata.html)
- Paper UFPR-ALPR mô tả một hệ thống ALPR thực tế với detection biển số và character recognition; dataset có annotation cho vị trí xe, vị trí biển số và vị trí từng ký tự. Điều này hữu ích khi đánh giá cả box-level lẫn character-level thay vì chỉ chấm text cuối. [Laroca et al. — A Robust Real-Time ALPR Based on YOLO](https://arxiv.org/abs/1802.09567), [UFPR-ALPR dataset](https://web.inf.ufpr.br/vri/databases/ufpr-alpr/)

**Hàm ý thiết kế:** mỗi observation nên lưu cả box gốc của detector và box sau tracker nếu hai loại này tồn tại. Không ghi đè box detector bằng box tracker, vì chúng trả lời hai câu hỏi khác nhau: “detector nhìn thấy gì?” và “tracker dự đoán vị trí đối tượng ở đâu?”.

### 2.2. Frame timestamp và vị trí trong video

Plate Recognizer phân biệt rõ:

- `position_sec`: vị trí tính bằng giây từ đầu file video; với camera live là số giây kể từ khi Stream khởi động.
- `timestamp`: thời điểm frame/result đến Stream.
- `timestamp_camera`: thời điểm capture từ camera, nếu camera phát RTCP Sender Report.

Thông tin này được nêu trong [Plate Recognizer FAQ](https://guides.platerecognizer.com/docs/stream/help/faq/) và [output format](https://guides.platerecognizer.com/docs/stream/results/). Với video file, `position_sec` là trường cần dùng để seek ngược vào bằng chứng; với camera live, cần lưu thêm clock source và timezone.

DeepStream event metadata cũng có các trường phù hợp cho event evidence: `frameId`, `confidence`, `trackingId`, `ts`, `sensorStr`, `videoPath` và phần mở rộng `extMsg` cho metadata riêng. [NvDsEventMsgMeta](https://docs.nvidia.com/metropolis/deepstream/7.1/python-api/PYTHON_API/NvDsMetaSchema/NvDsEventMsgMeta.html)

**Khuyến nghị:** không chỉ lưu một timestamp dạng chuỗi. Nên lưu đồng thời:

```text
source_video / camera_id
frame_index                 # số frame trong source
position_sec                # media time, ưu tiên cho video file
capture_ts_utc              # wall-clock, nếu có
capture_ts_camera           # camera time, nếu có
timezone
fps_at_ingest
```

`frame_index` và `position_sec` giúp tái lập theo video; `capture_ts_utc`/`capture_ts_camera` giúp đối chiếu với hệ thống camera, NVR hoặc access-control. Không nên suy ra timestamp chính xác chỉ từ thời điểm hệ thống xử lý xong.

### 2.3. Best frame và crop

Plate Recognizer cho biết khi plate bị che hoặc camera có độ phân giải thấp, tăng `max_prediction_delay` cho engine thêm thời gian tìm **best frame**. Stream mặc định có thể xử lý mỗi frame thứ hai và điều chỉnh `sample` theo tốc độ xe. [Configuration](https://guides.platerecognizer.com/docs/stream/configuration/), [FAQ](https://guides.platerecognizer.com/docs/stream/help/faq/)

Output của Stream có ảnh chụp tại thời điểm detection, webhook có thể gửi `original`, `vehicle`, `plate_img`, và có thể cấu hình video clip của xe. [Webhooks and Outputs](https://guides.platerecognizer.com/docs/stream/results/)

**Cần phân biệt hai khái niệm:**

- **Best frame để OCR:** frame có chất lượng biển số tốt nhất theo score chất lượng hoặc OCR.
- **Best frame để làm evidence:** frame đủ rõ biển số nhưng vẫn giữ ngữ cảnh xe/camera; có thể cần lưu cả ảnh toàn cảnh và crop.

Không nên chỉ lưu crop. Crop tốt cho đọc chữ và kiểm tra chi tiết, còn ảnh toàn cảnh chứng minh biển số thuộc xe nào, xuất hiện ở vùng nào và trong bối cảnh nào.

Một hàm điểm thực dụng (đây là khuyến nghị thiết kế, không phải công thức bắt buộc từ một nguồn duy nhất) có thể kết hợp:

```text
frame_quality =
    w_ocr * ocr_score
  + w_det * plate_detection_score
  + w_size * normalized_plate_area
  + w_sharp * sharpness_score
  - w_blur * motion_blur_score
  - w_occ * occlusion_ratio
```

Phải lưu các thành phần điểm và policy version, không chỉ lưu một `best_score`, để biết vì sao frame đó được chọn.

### 2.4. Tracking và aggregation

Ultralytics hướng dẫn dùng `model.track(frame, persist=True)` trên các frame liên tiếp để tracker duy trì state và track ID; có thể chọn BoT-SORT hoặc ByteTrack. `persist=True` chỉ đúng khi frame đến từ cùng một chuỗi video liên tục. [Ultralytics — Multi-object tracking](https://docs.ultralytics.com/modes/track)

DeepStream cung cấp tracker metadata, track history/terminated tracks và khả năng đưa metadata xuống event message. [Gst-nvtracker](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvtracker.html), [Metadata structures](https://docs.nvidia.com/metropolis/deepstream/dev-guide/sdk-api/group__metadata__structures.html)

Các paper về video ALPR đều củng cố lý do cần aggregation:

- CTM theo dõi biển số qua nhiều frame, căn chỉnh biển số rồi ghép các nhận dạng ký tự theo chuỗi thời gian thay vì phụ thuộc một frame. [Character Time-series Matching](https://arxiv.org/abs/2307.11336)
- Nghiên cứu Geo-CTM năm 2026 chỉ ra multi-frame fusion phụ thuộc mạnh vào motion model và association. Với camera chuyển động, association chỉ dựa trên ngưỡng khoảng cách cố định có thể làm fusion kém hơn single-frame; cần kiểm tra scale/perspective và loại duplicate track. [Geometry-Constrained Multi-Frame Character Association](https://www.mdpi.com/1424-8220/26/18/5704)

**Aggregation nên có ít nhất ba tầng:**

1. **Observation-level:** mỗi frame có box, crop, OCR text/candidates và score.
2. **Track-level:** gom observation theo `track_id`; chọn best frame; vote/weighted vote các ký tự hoặc các chuỗi candidate; ghi `first_seen`, `last_seen`, số frame, số lần OCR, số lần mất track.
3. **Event-level:** chốt một lần xuất hiện của xe/biển số, chống trùng khi cùng xe được tách thành nhiều track; lưu thời gian, camera, hướng/line crossing nếu có.

Không nên dùng `track_id` như định danh vật lý tuyệt đối. ID có thể bị đổi khi che khuất, dropped frames hoặc camera thay đổi. Nếu cần merge track, phải lưu lý do và điểm merge, không xoá các track gốc.

## 3. Evidence schema đề xuất

Schema dưới đây là đề xuất triển khai được rút ra từ các trường có trong DeepStream và Plate Recognizer, bổ sung các trường audit cần thiết. Tên field có thể đổi theo hệ thống nhưng semantics nên giữ ổn định.

```json
{
  "event_id": "uuid",
  "camera_id": "cam-01",
  "source_video": "s3://.../segment.mp4",
  "plate_text": "51A12345",
  "plate_text_normalized": "51A12345",
  "plate_confidence": 0.91,
  "detector_confidence": 0.95,
  "tracker_confidence": 0.88,
  "candidate_texts": [
    {"text": "51A12345", "score": 0.91},
    {"text": "51A12348", "score": 0.06}
  ],
  "track": {
    "track_id": 1842,
    "first_seen_frame": 120,
    "last_seen_frame": 247,
    "first_seen_position_sec": 4.0,
    "last_seen_position_sec": 8.23,
    "observation_count": 37,
    "track_merge_ids": []
  },
  "best_observation": {
    "frame_index": 213,
    "position_sec": 7.10,
    "capture_ts_utc": "2026-10-21T08:00:07.100Z",
    "plate_box": {"xmin": 847, "ymin": 80, "xmax": 944, "ymax": 105},
    "vehicle_box": {"xmin": 387, "ymin": 23, "xmax": 1493, "ymax": 577},
    "crop_uri": "evidence/event-uuid/plate-best.jpg",
    "full_frame_uri": "evidence/event-uuid/frame-best.jpg",
    "quality_score": 0.93,
    "selection_policy_version": "best-frame-v2"
  },
  "artifacts": {
    "annotated_clip_uri": "evidence/event-uuid/annotated.mp4",
    "raw_clip_uri": "evidence/event-uuid/raw.mp4",
    "metadata_uri": "evidence/event-uuid/metadata.json"
  },
  "provenance": {
    "detector_model": "...",
    "ocr_model": "...",
    "tracker": "ByteTrack",
    "pipeline_version": "...",
    "created_at": "2026-10-21T08:00:12.000Z"
  }
}
```

### Box convention

- Lưu pixel coordinates trên frame gốc, cùng `frame_width`, `frame_height` và convention rõ ràng (`xmin/ymin/xmax/ymax`, gốc ở góc trên-trái).
- Nếu có box sau resize/letterbox, lưu transform hoặc box đã quy đổi về frame gốc.
- Clip và ảnh phải giữ liên kết tới `frame_index`/`position_sec`; filename tự sinh không đủ làm provenance.
- Crop nên ghi padding, phép perspective rectification, resize/upscale và preprocessing đã áp dụng.

### Confidence convention

Ít nhất nên tách:

| Trường | Ý nghĩa | Dùng để |
|---|---|---|
| `detector_confidence` | độ tin cậy box là biển số/xe | lọc detection, đánh giá detector |
| `plate_confidence` hoặc `ocr_confidence` | độ tin cậy text/plate read | chọn candidate, quyết định review |
| `tracker_confidence` | độ tin cậy association/prediction | đánh giá continuity, không thay OCR |
| `quality_score` | điểm chất lượng frame/crop | chọn best frame |
| `event_confidence` | điểm tổng hợp sau aggregation | routing/alert, phải ghi policy |

Không cộng hoặc nhân các score này mà không định nghĩa calibration. Nếu cần một score cuối, nên lưu cả các score đầu vào và phiên bản công thức.

## 4. Annotated video và gói bằng chứng

Plate Recognizer hỗ trợ overlay bounding boxes, timestamp, `position_sec`, detection score, trajectory và text xác nhận vào video. [Configuration — `video_overlay`](https://guides.platerecognizer.com/docs/stream/configuration/)

DeepStream dùng OSD để vẽ bbox, label và thông tin lên output; reference application có tuỳ chọn bật/tắt OSD. [DeepStream reference application](https://docs.nvidia.com/deepstream/dev-guide/text/DS_ref_app_deepstream.html)

Annotated video nên là artifact phục vụ audit/debug, không thay thế raw video. Overlay tối thiểu:

```text
camera_id | frame_index | position_sec | capture timestamp
track_id | plate text | OCR score | detector score
plate box và vehicle box
```

Nên có hai dạng output:

- `raw_clip`: clip không overlay, dùng làm nguồn nguyên bản.
- `annotated_clip`: clip có box/label/track/timestamp, dùng để kiểm tra trực quan.

Nếu overlay chỉ được vẽ trên các frame được sample, phải ghi sampling policy và fps của output. Plate Recognizer lưu ý video overlay trên sample frames và khuyến nghị cấu hình `video_fps` phù hợp với `sample`; nếu bỏ qua điều này, video có thể có cảm giác giật hoặc timestamp không liên tục. [Configuration](https://guides.platerecognizer.com/docs/stream/configuration/)

## 5. Pipeline vận hành được khuyến nghị

### Bước A — Ingest và timebase

1. Ghi nhận `camera_id`, source URI, codec, resolution, nominal FPS, timezone.
2. Gán `frame_index` tăng đơn điệu; đọc PTS/media time nếu decoder cung cấp.
3. Không để inference latency làm thay đổi `position_sec` của frame.
4. Với RTSP, nếu có camera timestamp/RTCP, lưu cả camera time và server receive time.

### Bước B — Detection

1. Phát hiện vehicle và plate; lưu raw detections trước NMS/post-filter nếu cần phục vụ debug.
2. Lưu box pixel, class, model version, detector confidence.
3. Kiểm tra kích thước plate, aspect ratio, clipping ở biên frame và vùng ROI.

### Bước C — Tracking

1. Chạy tracker trên chuỗi frame cùng source; duy trì `track_id` và trajectory.
2. Lưu detection box và tracker box riêng.
3. Ghi nhận lost/occluded/reacquired state, track age, số lần ID switch nếu tracker cung cấp.
4. Không OCR toàn bộ frame nếu track chưa đủ điều kiện; có thể throttle theo `sample`, kích thước plate hoặc motion.

### Bước D — Crop và OCR

1. Crop theo plate box, có padding nhỏ nhưng không làm mất provenance của box gốc.
2. Lưu crop gốc và, nếu có, crop đã rectified/enhanced ở các URI khác nhau.
3. Chạy OCR trên nhiều observation chất lượng tốt trong track.
4. Lưu text top-1, candidates/top-k, score, region/layout và lỗi/empty result.

### Bước E — Best-frame và aggregation

1. Chấm chất lượng theo sharpness, plate size, occlusion, detector/OCR score và ổn định hình học.
2. Chọn `best_observation` nhưng vẫn giữ toàn bộ observation hoặc digest của chúng.
3. Tổng hợp text bằng weighted vote/character vote hoặc temporal fusion phù hợp motion model.
4. Chỉ chốt event khi track kết thúc, qua line/zone, hoặc đạt điều kiện latency; ghi rõ trigger.

### Bước F — Evidence package

Mỗi event nên tạo package bất biến hoặc versioned gồm:

```text
metadata.json
frame-best.jpg
plate-best.jpg
raw-clip.mp4
annotated-clip.mp4
observations.jsonl hoặc observations.parquet
```

Hash từng artifact, ghi retention policy và model/pipeline version. Nếu hệ thống có chỉnh sửa/đính chính event, tạo revision mới thay vì âm thầm ghi đè evidence cũ.

## 6. Tiêu chí đánh giá và kiểm thử

Nên đánh giá riêng các tầng sau:

- **Detection:** precision/recall, IoU của plate box, recall theo kích thước plate và điều kiện che khuất.
- **Tracking:** IDF1/HOTA hoặc ít nhất track fragmentation, ID switch, track duration.
- **OCR:** character accuracy, exact plate accuracy, edit distance, confidence calibration.
- **Aggregation:** exact plate accuracy theo track/event, false merge, duplicate event rate, latency từ first-seen đến commit.
- **Evidence:** tỷ lệ event có đủ full frame/crop/timestamp/clip; khả năng seek đúng `frame_index`/`position_sec`; hash/provenance integrity.
- **Annotated video:** box có khớp frame không, timestamp có đúng media time không, overlay có làm mất raw evidence không.

Các test case tối thiểu:

1. Xe đứng yên nhưng plate bị che trong vài frame.
2. Xe chạy nhanh gây motion blur.
3. Một xe bị tracker tách thành hai track.
4. Hai xe/plate gần nhau gây false merge.
5. Video có dropped frame hoặc VFR.
6. RTSP reconnect làm reset tracker.
7. OCR đọc khác nhau giữa các frame (`0/O`, `1/I`, ký tự mờ).
8. Plate sát biên frame hoặc vehicle box bị cắt.

## 7. Các điểm cần thận trọng

- `position_sec` không phải wall-clock timestamp; phải lưu cả hai khi cần điều tra sự kiện thực.
- Confidence của detector không chứng minh text OCR đúng. Một box rất chắc vẫn có thể đọc sai ký tự.
- Best frame không nên được chọn chỉ bằng detector confidence; frame lớn nhưng blur có thể tệ hơn frame nhỏ nhưng sắc nét.
- Aggregation có thể làm tăng độ ổn định nhưng cũng có thể “kéo sai” nếu tracker gộp nhầm hai xe hoặc motion model không phù hợp. Kết luận này được nhấn mạnh trong Geo-CTM. [Sensors 2026](https://www.mdpi.com/1424-8220/26/18/5704)
- `track_id` là định danh kỹ thuật trong một stream/session, không phải biển số và không phải định danh phương tiện toàn cục.
- Annotated video chỉ là view diễn giải; giữ raw frame/raw clip và metadata cấu trúc để tránh phụ thuộc OCR bằng mắt trên overlay.
- Biển số là dữ liệu có thể nhận diện/phục vụ theo dõi phương tiện. Cần giới hạn quyền truy cập, retention, audit log và masking trong môi trường nghiên cứu/demo phù hợp chính sách pháp lý nội bộ.

## 8. Tài liệu tham khảo chính

1. NVIDIA, *MetaData in the DeepStream SDK*: https://docs.nvidia.com/metropolis/deepstream/7.1/text/DS_plugin_metadata.html
2. NVIDIA, *Gst-nvtracker*: https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvtracker.html
3. NVIDIA, *NvDsEventMsgMeta*: https://docs.nvidia.com/metropolis/deepstream/7.1/python-api/PYTHON_API/NvDsMetaSchema/NvDsEventMsgMeta.html
4. NVIDIA, *DeepStream SDK metadata structures*: https://docs.nvidia.com/metropolis/deepstream/dev-guide/sdk-api/group__metadata__structures.html
5. NVIDIA, *DeepStream reference application*: https://docs.nvidia.com/deepstream/dev-guide/text/DS_ref_app_deepstream.html
6. Plate Recognizer, *Webhooks and Output formats for Stream*: https://guides.platerecognizer.com/docs/stream/results/
7. Plate Recognizer, *Configure Plate Recognizer Stream*: https://guides.platerecognizer.com/docs/stream/configuration/
8. Plate Recognizer, *Frequently Asked Questions for Stream*: https://guides.platerecognizer.com/docs/stream/help/faq/
9. Ultralytics, *Multi-object tracking*: https://docs.ultralytics.com/modes/track
10. Quang Huy Che, Tung Do Thanh, Cuong Truong Van, *Character Time-series Matching For Robust License Plate Recognition*: https://arxiv.org/abs/2307.11336
11. Ufuk Asil, İlker Yoncacı, *Geometry-Constrained Multi-Frame Character Association for License Plate Recognition on Moving Cameras*, Sensors 2026: https://www.mdpi.com/1424-8220/26/18/5704
12. R. Laroca et al., *A Robust Real-Time Automatic License Plate Recognition Based on the YOLO Detector*: https://arxiv.org/abs/1802.09567
13. UFPR, *UFPR-ALPR Dataset*: https://web.inf.ufpr.br/vri/databases/ufpr-alpr/

## 9. Tóm tắt quyết định thiết kế

Nếu cần một baseline rõ ràng cho hệ thống Camera-AI:

1. **Một event = một track xe/plate**, có `event_id` độc lập với `track_id`.
2. **Mỗi observation = một dòng bất biến** gồm frame/time, detector box, tracker box, crop URI, OCR candidates và các confidence riêng.
3. **Best frame = kết quả của policy có version**, lưu full frame + plate crop + điểm thành phần.
4. **Final plate = aggregation theo track**, kèm top-k candidates và trạng thái chưa chắc chắn/review.
5. **Evidence package = metadata + raw frame/clip + annotated clip + hash**, không chỉ một text string.
6. **Đánh giá riêng detector, tracker, OCR, aggregation và evidence integrity** để tránh nhầm một lỗi tracking thành lỗi OCR hoặc ngược lại.
