# Báo cáo thiết kế bằng chứng ALPR cho Camera-AI-System

**Ngày tổng hợp:** 21/10/2026  
**Phạm vi:** tổng hợp từ `ux-alpr.md`, `pipeline-alpr.md` và `video-review.md`.  
**Mục tiêu:** xác định các pattern ALPR đang được dùng thực tế và chuyển thành thiết kế evidence có thể kiểm tra, truy nguyên, xem lại theo video và xuất báo cáo.

## Tóm tắt điều hành

Các sản phẩm ALPR/parking thực tế không coi một chuỗi biển số là bằng chứng đầy đủ. Họ ghép nhiều lớp:

1. Ảnh/video ngữ cảnh để chứng minh đúng chiếc xe và vị trí.
2. Ảnh cận cảnh/crop biển số để kiểm tra ký tự.
3. Metadata nhận dạng: biển số, vùng, loại xe, màu, hướng và các confidence riêng.
4. Dấu vết sự kiện: thời gian, camera, site, loại event, rule/match list.
5. Luồng điều tra: lọc/tìm kiếm → mở chi tiết → xem ảnh/video → xác nhận hoặc xuất bằng chứng.

Đề xuất cho Camera-AI-System là xây evidence theo **event của một lượt xuất hiện của xe**, nhưng vẫn giữ liên kết ngược tới toàn bộ observation trong track. Mỗi event cần có `event_id` độc lập với `track_id`, best frame, plate crop, raw/annotated clip, timestamp theo media và wall-clock, các confidence tách biệt, provenance mô hình/pipeline và hash artifact.

## 1. Các pattern đang dùng ngoài thực tế

### 1.1. Evidence bundle nhiều lớp

Pattern chung của Plate Recognizer/ParkPow, Rekor Scout, Genetec và Milestone là hiển thị bằng chứng theo mức độ sâu tăng dần:

| Lớp | Câu hỏi cần trả lời | Artifact/metadata điển hình |
|---|---|---|
| Scan nhanh | Có event đáng chú ý không? | thumbnail, biển số, thời gian, camera, trạng thái |
| Xác minh | Có đúng xe và đọc đúng biển không? | ảnh context, ảnh vehicle, plate crop, box, candidate |
| Điều tra | Event xảy ra ở đâu/khi nào và vì sao? | video trước/sau, timeline, site, hướng, rule, match list |
| Audit/chứng minh | Có thể tái lập và chứng minh integrity không? | raw clip, annotated clip, JSON metadata, hash/signature, audit log |

Đây là pattern quan trọng nhất: **crop biển số và ảnh context bổ trợ cho nhau, không thay thế nhau**.

### 1.2. Bảng kết quả mật độ cao, chi tiết theo yêu cầu

- Plate Recognizer Stream dùng danh sách theo camera/thời gian, có ảnh và thuộc tính nhận dạng; confidence chi tiết có thể xem khi hover.
- ParkPow đưa confidence badge cạnh biển số, đồng thời dùng hover để mở vehicle image và license plate photo. Bảng vẫn có thể lọc theo site, camera, plate, confidence, loại xe, tag và spot.
- Rekor Scout tổ chức việc tìm kiếm theo plate, thời gian, case, site/camera; kết quả có ảnh/video xe, thuộc tính xe, hướng và estimated confidence.

Hàm ý: list nên phục vụ scan nhanh; detail drawer/panel mới là nơi xem ảnh lớn, candidate, JSON và hành động xác minh. Không nên đưa toàn bộ observation vào bảng chính.

### 1.3. Tách monitoring/cảnh báo khỏi investigation

Genetec phân biệt hit realtime với read history: hit có thể xuất hiện trên bản đồ realtime, còn reads được tra cứu trong lịch sử/report. Milestone tổ chức LPR theo event list + camera preview + filter + tìm kiếm registration number.

Pattern nên áp dụng:

- **Monitoring:** ưu tiên hit/denied/violation, trạng thái, mức ưu tiên và hành động nhanh.
- **Investigation:** ưu tiên tìm kiếm theo plate/time/camera/site, xem event liên quan và video.
- Clear một alert chỉ làm ẩn khỏi hàng đợi vận hành; không được hiểu là xóa evidence.

### 1.4. Ảnh context, plate image và video có vai trò riêng

Genetec gọi rõ hai lớp `context image` và `plate image`. Milestone đặt video liên quan tới event ở trung tâm màn hình preview. Rekor mở vehicle image cùng cropped tag view trong cửa sổ chi tiết.

Thiết kế thực tế nên hiển thị đồng thời:

- Ảnh rộng/camera context: xe thuộc cảnh nào, ở lane/site nào.
- Ảnh xe hoặc vehicle crop: nhận diện hình dáng/màu/model nếu có.
- Plate crop/LPR image: kiểm tra ký tự.
- Video trước/sau event: kiểm tra hướng di chuyển, continuity, entry/exit và tình huống gây nhầm.

### 1.5. Confidence không phải một con số duy nhất

Các nguồn kỹ thuật và sản phẩm cho thấy cần tách ít nhất:

- detector confidence: box có thực sự là xe/biển số không;
- OCR/plate confidence: text đọc được có đáng tin không;
- tracker confidence: association/prediction của track;
- frame quality score: chất lượng frame/crop để chọn best frame;
- event confidence: điểm tổng hợp sau aggregation hoặc match/rule.

Milestone dùng confidence cho validate/configuration và threshold; ParkPow hiển thị confidence ngay cạnh biển số; Rekor gọi là estimated confidence trong ngữ cảnh search. Vì các score khác bản chất, UI phải ghi rõ tên và tooltip, không gọi chung tất cả là “độ chính xác”.

### 1.6. Multi-frame và event/track thay cho một frame đơn

Pipeline thực tế giữ prediction trong nhiều frame để tìm best frame. Các nghiên cứu video ALPR cho thấy temporal aggregation/character association có thể ổn định kết quả, nhưng cũng có thể kéo sai nếu tracker merge nhầm hai xe hoặc motion model không phù hợp.

Do đó:

- observation là đơn vị bất biến ở cấp frame;
- track là nhóm observation của một đối tượng trong một stream/session;
- event là một lượt xuất hiện đã aggregation/chống trùng;
- `track_id` chỉ là định danh kỹ thuật, không phải định danh xe toàn cục.

### 1.7. Video review theo media time

Web video dùng `currentTime` làm media time. `occurredAt`/timestamp camera là wall-clock và phải lưu riêng. Khi review:

- seek theo `mediaTime`, không suy ra từ thời điểm xử lý;
- kiểm tra `video.seekable` trước khi nhảy tới marker;
- dùng `loadedmetadata`, `seeking`, `seeked` để quản lý lifecycle;
- marker ALPR là lớp UI/domain data riêng, không nên nhét toàn bộ evidence vào WebVTT;
- WebVTT `kind="metadata"` chỉ nên là lớp đồng bộ tùy chọn, payload nhỏ và chứa ID/thời gian.

## 2. Thiết kế đề xuất cụ thể cho Camera-AI-System

### 2.1. Mô hình domain

Đề xuất mô hình 3 tầng:

```
Observation (frame)
  → Track (chuỗi observation của một đối tượng)
  → Evidence Event (một lượt xuất hiện đã chốt/aggregation)
```

Mỗi event có hai liên kết bắt buộc:

```
event → best observation + evidence artifacts
event → toàn bộ observation/digest của track
```

Không ghi đè observation cũ khi có sửa/override. Nếu người vận hành sửa biển số hoặc trạng thái, tạo revision mới và audit log.

### 2.2. Pipeline đề xuất

1. **Ingest/timebase:** lưu camera, source URI, codec, kích thước, FPS, timezone; gán `frame_index` và đọc PTS/media time nếu có.
2. **Detection:** detect vehicle/plate; lưu box pixel, class, model version, detector score; giữ raw detection nếu cần debug.
3. **Tracking:** duy trì `track_id`, trajectory, lost/occluded/reacquired; lưu detector box và tracker box riêng.
4. **Crop/OCR:** crop theo plate box, lưu crop gốc và crop rectified/enhanced nếu có; chạy OCR trên nhiều observation phù hợp; giữ top-k candidates.
5. **Best frame:** tính điểm từ OCR, detector, kích thước plate, sharpness, blur, occlusion và ổn định hình học; lưu các thành phần và `selection_policy_version`.
6. **Aggregation:** tổng hợp text theo track bằng weighted vote/character vote/temporal fusion; không chốt chỉ từ frame đầu tiên.
7. **Event/chống trùng:** chốt khi track kết thúc, qua line/zone hoặc đạt latency policy; ghi trigger và nếu merge track thì lưu track gốc, lý do và score merge.
8. **Evidence package:** tạo metadata bất biến/versioned, best frame, plate crop, raw clip, annotated clip, observations digest và hash.

### 2.3. Quy ước timebase

Mỗi observation nên lưu đồng thời:

- `frame_index`: vị trí frame trong source;
- `media_time_sec`: vị trí trên timeline video, dùng để seek;
- `capture_ts_utc`: wall-clock chuẩn hóa UTC nếu có;
- `capture_ts_camera`: thời gian từ camera nếu có;
- `server_received_ts`: thời điểm hệ thống nhận frame nếu cần phân tích latency;
- `timezone` và `clock_source`.

Với clip cắt từ recording lớn, thêm `source_offset_sec` hoặc `recording_id` để biết `media_time_sec` tính theo clip hay recording gốc. Không dùng filename làm provenance.

### 2.4. Bố cục UX đề xuất

**Danh sách/monitoring:**

- thumbnail context;
- biển số chuẩn hóa + confidence OCR;
- thời gian có timezone, camera/site;
- loại event: `read`, `entry`, `exit`, `hit`, `authorized`, `denied`, `review_required`;
- badge trạng thái có chữ, không chỉ màu;
- filter theo time, camera, site, plate, event type, confidence, review status;
- realtime chỉ dành cho event cần vận hành; lịch sử có pagination/virtualization.

**Detail drawer/panel:**

- header: event type, plate text, confidence đúng loại, thời gian, camera/site, event ID;
- hai cột ảnh: context/vehicle và plate crop zoomable;
- box overlay trên ảnh gốc, có kích thước frame và transform nếu resize/letterbox;
- candidate top-k khi confidence thấp hoặc khi có disagreement giữa các frame;
- video trước/sau event với timeline custom và marker;
- entry/exit/duration nếu ghép được visit;
- rule/match list/tag giải thích hit hoặc authorized/denied;
- provenance mô hình/pipeline, integrity/hash và nút mở JSON khi cần;
- hành động: `Đã kiểm tra`, `Xác nhận`, `Từ chối`, `Gắn tag`, `Xuất bằng chứng`; reject/override bắt buộc reason.

**Review video:**

- marker instant cho read/hit; marker range cho thời gian xe hiện diện;
- click marker gọi một hàm seek duy nhất và chỉ highlight event sau `seeked`;
- marker ngoài vùng `seekable` hiển thị unavailable hoặc có policy tải lại;
- event list dùng domain JSON; WebVTT metadata chỉ là adapter đồng bộ tùy chọn;
- hit area marker đủ lớn, có keyboard/focus/ARIA label gồm plate, thời gian và loại event.

### 2.5. Chính sách best frame và evidence

Camera-AI-System nên tách hai mục tiêu:

- **OCR-best:** frame tối ưu cho đọc ký tự;
- **Evidence-best:** frame đủ rõ ký tự nhưng vẫn giữ ngữ cảnh xe/camera.

Có thể bắt đầu bằng điểm có trọng số:

```
quality =
  w_ocr * ocr_score
  + w_det * detector_score
  + w_size * normalized_plate_area
  + w_sharp * sharpness
  - w_blur * motion_blur
  - w_occ * occlusion_ratio
```

Đây là policy thiết kế, không phải công thức chuẩn. Cần lưu các thành phần, ngưỡng và version policy để giải thích vì sao một frame được chọn.

### 2.6. Integrity, quyền và retention

- Raw frame/raw clip là nguồn bất biến; crop, overlay và annotated clip là artifact dẫn xuất.
- Hash từng artifact; metadata ghi hash algorithm, created time và pipeline/model version.
- Evidence package nên versioned; sửa/đính chính tạo revision.
- Phân quyền theo site/camera/role; audit mọi lần xem, export, clear, accept/reject, override.
- Quy định retention theo mục đích và chính sách nội bộ; cân nhắc masking trong môi trường demo/nghiên cứu.
- Export nên gồm metadata, ảnh context, plate crop, clip nếu được phép và manifest/hash.

## 3. Schema dữ liệu evidence tối thiểu

Schema dưới đây là mức tối thiểu để vận hành, review và truy nguyên. Có thể mở rộng sau, nhưng không nên bỏ các trường timebase, provenance và liên kết artifact.

```json
{
  "event_id": "uuid",
  "event_type": "entry",
  "status": "review_required",
  "camera_id": "cam-01",
  "site_id": "site-a",
  "source": {
    "recording_id": "rec-20261021-0800",
    "source_uri": "s3://bucket/segment.mp4",
    "frame_width": 1920,
    "frame_height": 1080,
    "fps_at_ingest": 25,
    "timezone": "Asia/Ho_Chi_Minh",
    "clock_source": "camera"
  },
  "time": {
    "first_seen_media_time_sec": 4.0,
    "last_seen_media_time_sec": 8.23,
    "best_media_time_sec": 7.1,
    "first_seen_frame_index": 120,
    "best_frame_index": 213,
    "capture_ts_utc": "2026-10-21T08:00:07.100Z",
    "capture_ts_camera": "2026-10-21T15:00:07.100+07:00",
    "source_offset_sec": 0
  },
  "plate": {
    "text": "51A12345",
    "text_normalized": "51A12345",
    "region": "VN",
    "candidates": [
      {"text": "51A12345", "score": 0.91},
      {"text": "51A12348", "score": 0.06}
    ],
    "ocr_confidence": 0.91,
    "detector_confidence": 0.95,
    "tracker_confidence": 0.88,
    "event_confidence": 0.90
  },
  "track": {
    "track_id": "1842",
    "observation_count": 37,
    "track_merge_ids": [],
    "merge_reason": null
  },
  "best_observation": {
    "plate_box": {"xmin": 847, "ymin": 80, "xmax": 944, "ymax": 105},
    "vehicle_box": {"xmin": 387, "ymin": 23, "xmax": 1493, "ymax": 577},
    "box_coordinate_space": "original_pixels",
    "crop_uri": "evidence/event-uuid/plate-best.jpg",
    "vehicle_uri": "evidence/event-uuid/vehicle-best.jpg",
    "full_frame_uri": "evidence/event-uuid/frame-best.jpg",
    "quality_score": 0.93,
    "selection_policy_version": "best-frame-v2"
  },
  "artifacts": {
    "raw_clip_uri": "evidence/event-uuid/raw.mp4",
    "annotated_clip_uri": "evidence/event-uuid/annotated.mp4",
    "metadata_uri": "evidence/event-uuid/metadata.json",
    "observations_uri": "evidence/event-uuid/observations.jsonl"
  },
  "integrity": {
    "hash_algorithm": "sha256",
    "manifest_uri": "evidence/event-uuid/manifest.json"
  },
  "provenance": {
    "detector_model": "detector-v1",
    "ocr_model": "ocr-v1",
    "tracker": "ByteTrack",
    "pipeline_version": "pipeline-v1",
    "created_at": "2026-10-21T08:00:12.000Z"
  }
}
```

### 3.1. Quy tắc schema bắt buộc

- Box luôn quy về frame gốc; lưu `frame_width`, `frame_height` và convention tọa độ.
- Không gộp detector/tracker/OCR confidence thành một trường duy nhất.
- `media_time_sec` dùng cho seek; timestamp wall-clock dùng cho đối soát.
- `track_id` có phạm vi stream/session; `event_id` là định danh evidence ổn định.
- Candidate và observation có thể lưu ngoài bảng event, nhưng event phải truy cập được tới chúng.
- Crop phải ghi preprocessing nếu có: padding, rectification, resize/upscale.
- Artifact URI không đủ để chứng minh integrity; cần manifest/hash.

## 4. Checklist UX/QA

### 4.1. UX vận hành

- [ ] List có thumbnail, plate, OCR confidence, thời gian, camera/site và event type.
- [ ] Có filter theo khoảng thời gian, camera, site, plate, event type, confidence và review status.
- [ ] Detail hiển thị đồng thời context image và plate crop.
- [ ] Plate crop có zoom; ảnh gốc có box overlay khớp tọa độ.
- [ ] Candidate chỉ xuất hiện trong detail hoặc khi confidence/disagreement thấp.
- [ ] `OCR confidence`, `detector confidence`, `tracker confidence` và `match confidence` có nhãn riêng.
- [ ] Màu trạng thái luôn đi cùng text/label; hỗ trợ tương phản và color-blind.
- [ ] Hit/denied/authorized có rule hoặc lý do giải thích được.
- [ ] Clear alert không làm mất khỏi history/report.
- [ ] Reject/override/occupancy correction bắt buộc reason và ghi audit.
- [ ] Export có event ID, plate, ảnh, timestamp/timezone, camera, rule, confidence và manifest.

### 4.2. Video review

- [ ] Click event seek theo `mediaTime`, không theo thời điểm xử lý.
- [ ] Highlight event sau `seeked`, không xác nhận hoàn tất chỉ sau click.
- [ ] `loadedmetadata`/`durationchange` xử lý đúng `duration = NaN` và `Infinity`.
- [ ] Seek kiểm tra `video.seekable`; marker ngoài range hiển thị unavailable rõ ràng.
- [ ] Instant marker và duration marker không che nhau đến mức không thể click.
- [ ] Tua liên tục không để state cũ ghi đè seek mới nhất.
- [ ] Đổi camera/video dọn listener, cue, marker và selection của source cũ.
- [ ] Keyboard, focus, tooltip và ARIA label hoạt động cho marker/event list.
- [ ] Nếu có overlay box, kiểm thử scale, crop, letterbox và khác biệt `videoWidth`/CSS size.
- [ ] CORS, auth expiry, signed URL và quyền truy cập media/WebVTT được kiểm thử ở môi trường deploy.

### 4.3. Pipeline và evidence QA

- [ ] Có test xe đứng yên nhưng plate bị che trong một số frame.
- [ ] Có test xe chạy nhanh/motion blur.
- [ ] Có test tracker tách một xe thành hai track và hai xe bị false merge.
- [ ] Có test dropped frame, VFR và RTSP reconnect/reset tracker.
- [ ] Có test OCR dao động giữa các frame, ví dụ `0/O`, `1/I` và ký tự mờ.
- [ ] Có test plate sát biên frame, vehicle box bị cắt và ROI sai.
- [ ] `frame_index`, `media_time_sec`, camera time và server time không bị thay thế bởi inference completion time.
- [ ] Best frame có lý do chọn, score thành phần và policy version.
- [ ] Raw clip/frame không bị thay thế bởi overlay/crop.
- [ ] Mọi artifact trong package có thể truy ngược về event và source recording.
- [ ] Hash/manifest xác minh được; revision mới không âm thầm ghi đè revision cũ.
- [ ] Đo riêng detection, tracking, OCR, aggregation và evidence integrity.

### 4.4. Chỉ số nghiệm thu nên theo dõi

| Tầng | Chỉ số gợi ý |
|---|---|
| Detection | precision/recall, IoU plate box, recall theo kích thước/che khuất |
| Tracking | ID switch, track fragmentation, track duration, IDF1/HOTA nếu có ground truth |
| OCR | character accuracy, exact plate accuracy, edit distance, calibration |
| Aggregation | exact plate accuracy theo event, duplicate event rate, false merge, commit latency |
| Evidence | % event đủ frame/crop/time/clip, seek accuracy, hash integrity |
| Video overlay | box khớp frame, timestamp đúng media time, output không thay raw |

## 5. Lộ trình triển khai đề xuất

### Giai đoạn 1 — Evidence tối thiểu

- Chuẩn hóa `event_id`, `track_id`, `frame_index`, `media_time_sec`, `capture_ts_utc`.
- Lưu full frame, plate crop, detector/OCR confidence, candidate top-k và camera/site.
- Có detail view context + crop + JSON metadata.

### Giai đoạn 2 — Review và vận hành

- Thêm raw/annotated clip, timeline marker, seek theo media time và filter điều tra.
- Thêm entry/exit pairing, duration, rule/match list, review status và audit actions.
- Thêm export evidence package có manifest/hash.

### Giai đoạn 3 — Chất lượng và audit nâng cao

- Version hóa best-frame/aggregation policy.
- Thêm track merge provenance, revision model, calibration và dashboard QA.
- Cân nhắc signature, retention automation, masking và phân quyền chi tiết theo site/camera.

## 6. Danh sách URL nguồn

### Sản phẩm và pattern UX

1. Plate Recognizer — Monitor Stream: https://guides.platerecognizer.com/docs/stream/monitoring/
2. Plate Recognizer — Webhooks and Output formats for Stream: https://guides.platerecognizer.com/docs/stream/results/
3. Plate Recognizer — Configure Stream: https://guides.platerecognizer.com/docs/stream/configuration/
4. Plate Recognizer — Snapshot results: https://guides.platerecognizer.com/docs/snapshot/results/
5. Plate Recognizer — ParkPow Dashboard: https://guides.platerecognizer.com/docs/parkpow/user-guide/dashboard/
6. Plate Recognizer — ParkPow: https://platerecognizer.com/parkpow
7. Plate Recognizer — ParkPow Sites: https://guides.platerecognizer.com/docs/parkpow/user-guide/settings/sites/
8. Rekor Scout — Dashboard: https://docs.rekor.ai/scout/scout-dashboard/dashboard
9. Rekor Scout — Advanced Search: https://docs.rekor.ai/scout/scout-dashboard/advanced-search
10. Rekor Scout — Dispatch Map: https://docs.rekor.ai/scout/scout-dashboard/dispatch-map
11. Genetec — Monitoring ALPR events in tile mode: https://techdocs.genetec.com/r/en-US/Security-Center-User-Guide-5.13/Monitoring-ALPR-events-in-tile-mode
12. Genetec — ALPR Manager Properties: https://techdocs.genetec.com/r/en-US/Security-Center-Administrator-Guide-5.12/ALPR-Manager-Properties-tab
13. Genetec Web App — ALPR hit/read events on maps: https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hit-and-read-events-on-the-Genetec-Web-App
14. Genetec Web App — Monitoring ALPR hits: https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hits-in-the-ALPR-monitoring-task-of-the-Genetec-Web-App
15. Milestone — The LPR tab: https://doc.milestonesys.com/xprotect/xprotect-lpr-for-operators/2026r1/en/the-lpr-tab
16. Milestone — Validate configuration: https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2025r3/en/validate-configuration
17. Milestone — Recognition settings: https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2026r1/en/recognition-settings-tab
18. Milestone — XProtect LPR Feature Brief: https://doc.milestonesys.com/latest/en-US/resources/pdfs/mil/featurebriefs/xprotectlprfeaturebrief.pdf

### Pipeline, tracking và dữ liệu

19. NVIDIA DeepStream metadata: https://docs.nvidia.com/metropolis/deepstream/7.1/text/DS_plugin_metadata.html
20. NVIDIA Gst-nvtracker: https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvtracker.html
21. NVIDIA NvDsEventMsgMeta: https://docs.nvidia.com/metropolis/deepstream/7.1/python-api/PYTHON_API/NvDsMetaSchema/NvDsEventMsgMeta.html
22. NVIDIA DeepStream metadata structures: https://docs.nvidia.com/metropolis/deepstream/dev-guide/sdk-api/group__metadata__structures.html
23. NVIDIA DeepStream reference application: https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_ref_app_deepstream.html
24. Ultralytics — Multi-object tracking: https://docs.ultralytics.com/modes/track
25. Character Time-series Matching for Robust License Plate Recognition: https://arxiv.org/abs/2307.11336
26. Geometry-Constrained Multi-Frame Character Association for LPR: https://www.mdpi.com/1424-8220/26/18/5704
27. A Robust Real-Time ALPR Based on the YOLO Detector: https://arxiv.org/abs/1802.09567
28. UFPR-ALPR Dataset: https://web.inf.ufpr.br/vri/databases/ufpr-alpr/

### Video review trên web

29. WHATWG HTML Media: https://html.spec.whatwg.org/multipage/media.html
30. MDN — HTMLMediaElement: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
31. MDN — currentTime: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime
32. MDN — loadedmetadata: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadedmetadata_event
33. MDN — Audio/video delivery và TimeRanges: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery
34. W3C — WebVTT: https://www.w3.org/TR/webvtt1/
35. MDN — WebVTT API: https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API
36. MDN — `<track>` element: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track
37. MDN — TextTrack cuechange: https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/cuechange_event
38. MDN — TextTrack activeCues: https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/activeCues
39. MDN — requestVideoFrameCallback: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
40. React — Synchronizing with Effects: https://react.dev/learn/synchronizing-with-effects
41. React — useEffect reference: https://react.dev/reference/react/useEffect
42. Vite — Static Asset Handling: https://vite.dev/guide/assets
43. Vite — Building for Production: https://vite.dev/guide/build

## Kết luận

Baseline nên chốt cho Camera-AI-System là: **một event evidence có best frame + crop + video + metadata timebase + toàn bộ observation liên quan + provenance/hash**. UI tách list scan nhanh, detail xác minh và review video điều tra. Pipeline tách detector, tracker, OCR, aggregation và integrity thành các lớp có thể đo lường riêng; cách này giúp phân biệt lỗi đọc biển, lỗi tracking, lỗi timebase và lỗi bằng chứng thay vì gộp tất cả thành một confidence không giải thích được.

