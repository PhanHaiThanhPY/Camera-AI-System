# Thiết kế bằng chứng nhận dạng biển số cho ALPR/parking

Ngày nghiên cứu: 2026-10-21  
Phạm vi: tài liệu và hướng dẫn sản phẩm chính thức của Plate Recognizer/ParkPow, Rekor Scout, Genetec Security Center/Web App và Milestone XProtect LPR.  
Mục tiêu: ghi nhận các thành phần bằng chứng mà người vận hành dùng để kiểm tra một lần đọc biển số, một lượt xe vào/ra hoặc một cảnh báo.

## Tóm tắt nhanh

Các sản phẩm đều dùng một mô hình bằng chứng nhiều lớp:

1. **Ngữ cảnh rộng**: ảnh/video của xe và môi trường xung quanh để trả lời “đây có đúng chiếc xe/sự kiện không?”.
2. **Bằng chứng cận cảnh**: ảnh biển số đã crop hoặc ảnh LPR chuyên dụng để trả lời “chữ trên biển có đọc đúng không?”.
3. **Dữ liệu định danh**: biển số, vùng/quốc gia, loại xe, màu, hãng/model, hướng di chuyển và confidence.
4. **Dấu vết sự kiện**: thời gian, camera, site/vị trí, loại sự kiện (read/hit/authorized/denied/entry/exit), match list hoặc rule.
5. **Luồng kiểm tra**: danh sách có lọc/tìm kiếm → mở detail → xem ảnh/video liên quan → xác nhận/chấp nhận/từ chối/xuất báo cáo.

Điểm khác biệt UX đáng chú ý:

- **ParkPow** đưa confidence vào ngay bảng vehicle records và dùng hover để mở nhanh ảnh xe + ảnh biển số.
- **Rekor Scout** ưu tiên điều tra: search/alert/map, ảnh xe và crop biển số mở trong cửa sổ chi tiết; confidence được mô tả là “estimated confidence” trong kết quả tìm kiếm.
- **Genetec** tách rõ context image và plate image; bổ sung loại event, màu trạng thái, địa chỉ và khả năng kiểm tra chữ ký số.
- **Milestone** gắn LPR event với video trong Smart Client; mạnh về lọc, match list, alarm và xuất báo cáo. Confidence được dùng để cấu hình/ngưỡng và kiểm tra chất lượng, nhưng không nổi bật như một badge trong màn hình vận hành.

## So sánh theo sản phẩm

| Sản phẩm/tài liệu | Ảnh toàn cảnh / video | Ảnh crop biển số | Box / vùng phát hiện | Confidence | Timestamp & sự kiện | Cách kiểm tra của người dùng |
|---|---|---|---|---|---|---|
| Plate Recognizer Stream | Mỗi kết quả có image; có thể gửi `original`, `vehicle` hoặc video overlay | Có `plate_img` trong webhook/output khi cấu hình | JSON/CSV có `box`; overlay có thể hiển thị plate bounding box | Hover để xem score; opacity thay đổi theo confidence | Camera ID, timestamp, timestamp camera, position trong video; event `recognition` | Mở Results theo camera, sắp xếp theo thời gian, hover score, copy JSON |
| Plate Recognizer ParkPow | Vehicle image trong bảng bản ghi | Hover hiển thị license plate photo | Không nhấn mạnh box trong UI bảng; box có ở lớp nhận dạng | Badge trong cột License Plate; lọc theo ngưỡng 10% | Entrance/Exit, duration, site/camera/spot, tag; realtime mode | Lọc site/camera/plate/confidence/type/tag, hover để đối chiếu, export CSV |
| Rekor Scout | Captured image/video của xe; map theo site/camera | Dispatch Map mở vehicle image và cropped tag view | Không nêu rõ bounding box trong UI tài liệu | Advanced Search có estimated confidence | Site, camera, direction, thời điểm capture, alert/list | Search plate theo khoảng thời gian/case; click alert để mở vị trí và cửa sổ detail |
| Genetec Security Center / Web App | Context image góc rộng; map và tile/event pane | Plate image từ camera ALPR kèm OCR interpretation | Không nêu box trên tile mặc định | Có Confidence Score trong dữ liệu/export; tile hướng tới kiểm tra ảnh và OCR | Event name read/hit, plate/state, date/time, address, hotlist/hit rule | Chọn event từ list/tile/map, mở side pane, xem chi tiết; verify digital signature; in hit proof |
| Milestone XProtect LPR | Camera preview và video recordings liên quan | Tài liệu vận hành nói về plate recognition data, không mô tả crop riêng ở LPR tab | Recognition area cấu hình trong camera; không phải evidence overlay chính | Confidence level trong validation; có thể discard recognitions dưới ngưỡng | LPR event list, camera, period, match list, plate style; match có thể trigger alarm | Lọc event, search registration number, xem preview/video, match list, export PDF report |

## 1. Plate Recognizer

### 1.1 Stream Monitor và Results

**Cách hiển thị bằng chứng**

- Màn hình Monitor/Results đặt kết quả theo camera và thời gian. Mỗi dòng có camera ID, timestamp, image và các thuộc tính nhận dạng như biển số, vùng, hãng/model và loại xe.
- Confidence không chiếm chỗ cố định trong bảng: người dùng **hover** lên kết quả để xem score chính xác; độ mờ/opacity thay đổi để tạo tín hiệu nhanh khi quét nhiều kết quả.
- Khi cần điều tra sâu hơn, người dùng click camera ID để lọc theo camera; Results có thứ tự thời gian và phân trang.
- Output có thể copy dạng JSON, phù hợp cho kiểm tra kỹ thuật hoặc đối chiếu với hệ thống khác.

**Câu trích dẫn ngắn**

> “Each result shows the camera ID, timestamp, image...” — Plate Recognizer Stream Monitor.

> “Precise confidence scores are shown by hovering over items.” — Plate Recognizer Stream Monitor.

**Bằng chứng ở lớp dữ liệu**

- Stream webhook/output có `timestamp`, `timestamp_camera`, `plate`, `score`, `box`, `file`, `vehicle`, `region`, `orientation`, `direction` và các candidate.
- Có thể gửi `original`, `vehicle`, `plate_img`; tức là cùng một event có thể lưu ảnh gốc, ảnh xe và ảnh crop biển số thay vì chỉ giữ text.
- Có thể chèn timestamp và thông tin recognition lên frame/video overlay. Điều này hữu ích cho review hậu kiểm vì chữ và thời điểm nằm ngay trên ảnh/video.

**Hàm ý UX**

- Bảng vận hành nên giữ scan nhanh: ảnh thumbnail + plate + timestamp + camera.
- Confidence chi tiết có thể để hover/click, nhưng nên có một tín hiệu nhìn nhanh (badge, màu hoặc opacity) và khả năng lọc theo ngưỡng.
- Detail drawer nên cho chuyển qua lại giữa ảnh gốc, ảnh xe, crop biển số và JSON/event metadata.

Nguồn:

- [Plate Recognizer — Monitor Stream](https://guides.platerecognizer.com/docs/stream/monitoring/) — “Each result shows the camera ID, timestamp, image...” và confidence xem khi hover.
- [Plate Recognizer — Webhooks and Output formats for Stream](https://guides.platerecognizer.com/docs/stream/results/) — output có `box`, `score`, `timestamp`, `timestamp_camera`, candidate và `plate_img`.
- [Plate Recognizer — Configure Stream](https://guides.platerecognizer.com/docs/stream/configuration/) — overlay timestamp, confirmed recognition, plate bounding box và detection zone.

### 1.2 Snapshot API

Snapshot cho thấy cấu trúc bằng chứng mà UI ALPR nên có thể truy nguyên:

- `box` là tọa độ vùng biển số trong ảnh.
- `plate` là text đã đọc; `score` là confidence từ 0 đến 1.
- `candidates` lưu các khả năng thay thế kèm score, giúp người dùng hiểu trường hợp gần đúng thay vì chỉ thấy một kết quả tuyệt đối.
- Payload có filename, timestamp, camera ID và toàn bộ kết quả trong cùng một request.

**Câu trích dẫn ngắn**

> “box: Bounding box coordinates of the detected plate.” — Plate Recognizer Snapshot.

> “candidates: Alternative plate possibilities with scores.” — Plate Recognizer Snapshot SDK.

Thiết kế nên giữ candidate ở lớp chi tiết hoặc khi confidence thấp; không nên làm rối bảng chính bằng quá nhiều lựa chọn nếu kết quả đã rõ.

Nguồn:

- [Plate Recognizer — Webhooks and Output formats for Snapshot](https://guides.platerecognizer.com/docs/snapshot/results/) — payload có `timestamp`, `box`, `plate`, `score`, `region.score`.
- [Plate Recognizer — Snapshot Android API Reference](https://guides.platerecognizer.com/docs/snapshot/snapshot-android/api-reference/) — định nghĩa box, score, candidates, vehicle và direction confidence.

### 1.3 ParkPow parking dashboard

ParkPow là ví dụ sát bài toán parking nhất trong nhóm nghiên cứu.

**Cách hiển thị**

- Dashboard có chart visits/occupancy, summary cards Authorized/Denied/Vehicle Types/Alerts và bảng vehicle records.
- Bảng hiển thị Entrance, Exit, Duration, License Plate + confidence badge, Region + confidence, Make–Model, Type, Orientation, Site/Cameras/Spot và Tags.
- Hover vào một record mở popup gồm **vehicle image**, **license plate photo** và chi tiết make/model/region. Đây là pattern “evidence on demand”: bảng giữ mật độ thông tin cao, ảnh lớn chỉ mở khi cần xác minh.
- Có realtime mode để cập nhật detection mới; người vận hành vẫn có thể lọc theo site, camera, plate, confidence, vehicle type, tag và parking spot.
- Export CSV cho phép chọn timezone; phù hợp cho đối chiếu vận hành, tính phí, báo cáo và lưu trữ.

**Câu trích dẫn ngắn**

> “The license plate number with confidence score badge.” — ParkPow Dashboard.

> “A popup showing the captured vehicle image [and] the license plate photo...” — ParkPow Dashboard.

**Hàm ý UX**

- Đặt confidence cạnh text biển số, không giấu hoàn toàn trong detail.
- Dùng hover/click để hiện cặp ảnh context + crop, tránh bắt người dùng rời bảng.
- Với parking, cần hiển thị **entrance/exit/duration** như một “event pair”, không chỉ là các read rời rạc.
- “Authorized/Denied” nên giải thích được bằng tag/rule; badge trạng thái không nên là tín hiệu thị giác không có lý do.
- Nếu sửa occupancy thủ công, cần lưu time và vehicle count của lần correction để phân biệt số đo camera với số liệu đã hiệu chỉnh.

Nguồn:

- [Plate Recognizer — ParkPow Dashboard](https://guides.platerecognizer.com/docs/parkpow/user-guide/dashboard/) — cấu trúc chart, filter, bảng records, confidence badge, hover preview và export timezone.
- [Plate Recognizer — ParkPow Parking Management](https://platerecognizer.com/parkpow) — monitor xe vào/ra, duration, occupancy, alerts, search và analytics.
- [Plate Recognizer — ParkPow Sites](https://guides.platerecognizer.com/docs/parkpow/user-guide/settings/sites/) — occupancy có thể drift do missed reads/tailgating; có correction theo Date & Time và Vehicle Count.

## 2. Rekor Scout

### 2.1 Dashboard và Advanced Search

Rekor trình bày ALPR như một hệ thống điều tra lịch sử, không chỉ là stream sự kiện.

- Dashboard kết hợp search với captured images/videos của xe, plate information và thuộc tính xe như state, color, make, body type.
- Advanced Search chia màn hình thành panel điều kiện và panel kết quả; kết quả có site, camera, plate, make/model/color, direction, estimated confidence và capture time.
- Quy trình yêu cầu plate number, date/time và case number trước khi search; điều này gợi ý hệ thống thực tế nên có context vụ việc/case để tăng khả năng audit.

**Câu trích dẫn ngắn**

> “The dashboard has search capability and displays captured images/videos of vehicles...” — Rekor Scout Dashboard.

> “The search results include the site... camera... estimated confidence... and the time...” — Rekor Scout Advanced Search.

### 2.2 Dispatch Map và alert

- Dispatch Map hiển thị historical và real-time captures trên bản đồ theo camera site.
- Alert List giữ các plate read mới nhất đã kích hoạt alert, kèm site/location, camera, time và list.
- Click một alert sẽ đưa người dùng tới vị trí capture và mở cửa sổ có vehicle image + cropped tag view.
- Search Plates cho phép nhập plate, time increment và mô tả ngắn để xem plate đã được đọc bao nhiêu lần tại các location.

**Câu trích dẫn ngắn**

> “...show all the associated information in another window that contains the vehicle image and cropped view of the tag.” — Rekor Dispatch Map.

**Hàm ý UX**

- Map nên là lớp định vị và triage; detail pane mới là nơi xem bằng chứng.
- Alert phải nối được 4 khóa: plate, camera/site, time, alert/list.
- Crop nên mở cùng ảnh xe, không thay thế ảnh xe; người dùng cần bối cảnh để loại false positive.
- “Estimated confidence” nên có tooltip giải thích đây là confidence của match/search hay confidence OCR; hai khái niệm không nên dùng chung nhãn nếu khác bản chất.

Nguồn:

- [Rekor Scout — Dashboard](https://docs.rekor.ai/scout/scout-dashboard/dashboard) — dashboard, captured images/videos và vehicle characteristics.
- [Rekor Scout — Advanced Search](https://docs.rekor.ai/scout/scout-dashboard/advanced-search) — search parameters và kết quả có estimated confidence/time.
- [Rekor Scout — Dispatch Map](https://docs.rekor.ai/scout/scout-dashboard/dispatch-map) — alert list, map, vehicle image, crop tag và search plates.

## 3. Genetec Security Center và Web App

### 3.1 Security Center tile mode

Genetec mô tả rất rõ “evidence bundle” trong một tile:

- **Entity name** và **ALPR event name** ở toolbar.
- Màu nền tile phân biệt read, hotlist hit, permit hit, shared permit/overtime hit.
- **Context image** là ảnh góc rộng của xe từ context camera.
- **Plate image** là ảnh từ camera ALPR kèm OCR interpretation.
- Plate number, plate state, date/time và address.
- Với hit, có hit rule; với overtime hit có thể có tire/overview image.
- Người dùng có thể verify digital signature; hit có thể mở thêm attributes, accept/reject reason và in event data làm proof.

**Câu trích dẫn ngắn**

> “Context image: Wide-angled image of the vehicle...” — Genetec Security Center.

> “Plate image: Image captured by the ALPR camera and the OCR interpretation...” — Genetec Security Center.

Đây là mẫu tốt cho màn hình chi tiết: ảnh context và crop/plate image có vai trò khác nhau, còn trạng thái event và rule giải thích vì sao event được tạo.

Nguồn:

- [Genetec — Monitoring ALPR events in tile mode](https://techdocs.genetec.com/r/en-US/Security-Center-User-Guide-5.13/Monitoring-ALPR-events-in-tile-mode) — danh sách trường trong tile, màu event, high-resolution plate image, verify signature và in proof.
- [Genetec — ALPR Manager Properties](https://techdocs.genetec.com/r/en-US/Security-Center-Administrator-Guide-5.12/ALPR-Manager-Properties-tab) — các trường export gồm context image, plate image, local/UTC date-time, GUID, overview image, parking lot và matched plate.

### 3.2 Genetec Web App: map, watch list và ALPR monitoring

- Trên Maps, hit ALPR xuất hiện realtime; popup gắn với ALPR unit hiển thị hotlist name, plate number, vehicle image và license plate image.
- Click unit mở side pane chứa recent reads/hits; click event mở detail pane.
- Watch list cho phép theo dõi các entity đã chọn; người dùng có thể click một event để xem detail và thêm vehicle từ plate read vào hotlist.
- ALPR Monitoring có filter theo hotlist, priority và ALPR unit; có thể bật Include reads. Hit đã clear vẫn còn trong reports.
- Một điểm cần ghi nhận: tài liệu nói **ALPR reads không hiển thị realtime trên maps**, trong khi hits có. Đây là khác biệt quan trọng giữa màn hình cảnh báo và màn hình lịch sử/điều tra.

**Hàm ý UX**

- Tách rõ “monitoring” (hit realtime, ưu tiên cảnh báo) và “investigation” (read history, search/report).
- Dùng màu trạng thái nhưng luôn kèm label/rule; không dựa vào màu đơn độc.
- Nếu người dùng clear alert, UI phải nói rõ “đã clear khỏi màn hình” chứ không imply “đã xóa bằng chứng”.

Nguồn:

- [Genetec Web App — Monitoring ALPR hit and read events on maps](https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hit-and-read-events-on-the-Genetec-Web-App) — popup, side pane, map và watch list.
- [Genetec Web App — Monitoring ALPR hits](https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hits-in-the-ALPR-monitoring-task-of-the-Genetec-Web-App) — filter, Include reads, detail pane và hành vi clear hit.

## 4. Milestone XProtect LPR

### 4.1 Operator flow

Trong XProtect Smart Client, LPR tab được tổ chức theo event list + camera preview:

- Người dùng điều tra LPR events từ mọi camera.
- Preview hiển thị video liên quan tới event; phía dưới là plate information, match-list details và plate style.
- Có filter theo period, country module, LPR camera, match list và plate style.
- Có Search registration number để tìm plate cụ thể.
- Có thể export relevant events thành PDF report.

**Câu trích dẫn ngắn**

> “The tab includes an LPR event list and an LPR camera preview.” — Milestone XProtect LPR.

> “In the preview, you can view video associated with LPR event details.” — Milestone XProtect LPR.

Milestone đặt bằng chứng chuyển động/video ở trung tâm hơn là chỉ ảnh tĩnh. Đây là hướng phù hợp khi người dùng cần xem trước–sau của xe qua vùng camera.

Nguồn:

- [Milestone — The LPR tab](https://doc.milestonesys.com/xprotect/xprotect-lpr-for-operators/2026r1/en/the-lpr-tab) — event list, camera preview, filters, search registration number và PDF report.
- [Milestone — XProtect LPR Feature Brief](https://doc.milestonesys.com/latest/en-US/resources/pdfs/mil/featurebriefs/xprotectlprfeaturebrief.pdf) — screenshot mô tả Smart Client với video lớn, vehicle view, danh sách plate event và timeline.

### 4.2 Confidence và kiểm tra cấu hình

- Validate configuration phân tích snapshots và hiển thị registration number, country code, character height, confidence level, processing time, plate style và alias.
- Người dùng có thể bấm Next để xem từng snapshot và tìm nguyên nhân recognition fail.
- Recognition settings cho phép discard recognitions dưới một confidence threshold.
- Recognition area xác định vùng ảnh dùng để detect plate; nếu cần vehicle properties thì vùng có thể mở rộng để bao phủ toàn bộ xe.

**Hàm ý UX**

- Confidence có hai vai trò: ngưỡng lọc/đảm bảo chất lượng ở admin và tín hiệu tin cậy trong điều tra. Nên phân biệt “OCR confidence” với “match-list confidence”.
- Màn hình QA nên cho xem snapshot gốc + kết quả + character height + processing time + confidence, rồi chuyển từng ảnh bằng Next.
- Màn hình operator nên ưu tiên event/video, chỉ đưa confidence vào detail nếu nó giúp quyết định.

Nguồn:

- [Milestone — Validate configuration](https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2025r3/en/validate-configuration) — result summary và review từng snapshot.
- [Milestone — Recognition settings tab](https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2026r1/en/recognition-settings-tab) — recognition area, discard below confidence và hướng dẫn validate.
- [Milestone — XProtect LPR system architecture](https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2026r1/en/xprotect-lpr-system-architecture) — flow camera → LPR server → event server → Smart Client và match-list event/alarm.

## 5. Mẫu thông tin nên có trong màn hình “chi tiết một lần đọc”

### Lớp 1 — định danh nhanh

- Plate text, giữ nguyên capitalization/format hệ thống nhận được.
- Confidence OCR dạng phần trăm hoặc score, kèm tooltip giải thích.
- Region/state/country và confidence riêng nếu có.
- Event type: read, entry, exit, hit, authorized, denied, overtime hoặc unknown.
- Timestamp có timezone; nếu có cả timestamp camera và timestamp server thì hiển thị cả hai trong detail.

### Lớp 2 — bằng chứng hình ảnh

- Ảnh context/wide của xe và môi trường.
- Ảnh vehicle crop nếu có.
- Ảnh plate crop/LPR image, zoom được.
- Bounding box overlay trên ảnh gốc; click box để focus crop.
- Nếu có nhiều biển số hoặc nhiều candidate, đánh số và nối mỗi box với text/candidate tương ứng.

### Lớp 3 — ngữ cảnh vận hành

- Camera ID, site/parking lot, lane/spot, hướng di chuyển.
- Entrance/exit và duration; nếu ghép được hai read thành một visit thì hiển thị hai mốc thời gian.
- Match list/tag/rule đã tạo hit hoặc authorized/denied.
- Make/model/color/type/orientation, có confidence riêng khi được model trả về.

### Lớp 4 — hành động kiểm tra

- Mở video trước/sau event và timeline.
- Xem candidate plate khi confidence thấp.
- Accept/reject hoặc mark as verified; bắt buộc reason khi reject/override.
- Add to hotlist/tag/vehicle record nếu người dùng có quyền.
- Export evidence/report: ảnh context, ảnh crop, plate text, confidence, timestamp, camera, event ID và rule.
- Audit log: ai xem, ai sửa, ai clear/accept/reject, lúc nào.

## 6. Đề xuất bố cục cho hệ thống ALPR/parking

```text
┌─────────────────────────────────────────────────────────────┐
│ [HIT / ENTRY / EXIT]  51A-123.45  [98%]  21/10/2026 10:32:14 │
│ Camera: Cổng Bắc  • Site: Bãi A  • Hướng: Vào  • ID: EVT-... │
├──────────────────────────────┬──────────────────────────────┤
│ Ảnh context / video           │ Plate crop / OCR              │
│ [wide vehicle image]          │ [zoomable crop]               │
│ [box overlay + play timeline] │ 51A-123.45  98%               │
│                              │ Candidates: ...              │
├──────────────────────────────┴──────────────────────────────┤
│ Visit: Entry 10:32:14  | Exit —  | Duration —                │
│ Rule/tag: Visitor / Allowed  | Region: VN 99%                 │
│ [Mở video] [Đã kiểm tra] [Gắn tag] [Xuất bằng chứng]          │
└─────────────────────────────────────────────────────────────┘
```

Nguyên tắc:

- Ảnh context và crop phải cùng nhìn thấy trên một màn hình detail; không để người dùng suy luận từ text một mình.
- Confidence phải gắn với đúng đối tượng: plate OCR, region, vehicle attribute và match/search confidence là các score khác nhau.
- Timestamp phải có timezone và nguồn thời gian (camera/server) khi lệch có thể ảnh hưởng đối soát.
- Không dùng màu làm bằng chứng duy nhất; luôn có chữ “Hit”, “Denied”, “Verified” và lý do.
- Để list làm nơi scan nhanh, detail drawer làm nơi kiểm tra, video/report làm nơi chứng minh hoặc audit.
- Giữ nguyên ảnh gốc bất biến; overlay/box/crop là lớp hiển thị dẫn xuất. Nếu ảnh bị thay đổi, cần hash/signature hoặc trạng thái integrity.

## 7. Các câu hỏi UX cần kiểm chứng với người vận hành

- Người dùng cần ảnh context lớn đến mức nào để phân biệt xe, hay crop biển số là đủ trong phần lớn ca?
- Confidence nào là ngưỡng “cần xem lại” theo từng camera, ánh sáng và quốc gia/vùng biển?
- Khi một xe có nhiều lần đọc trong vài giây, người dùng muốn xem từng read hay một visit đã gộp?
- Với entry/exit, điều gì khiến người dùng tin rằng hai read thuộc cùng một visit?
- Cần hiển thị candidate plate trong list hay chỉ khi confidence thấp trong detail?
- Người dùng có cần chứng minh tính toàn vẹn (signature/hash) cho mọi event hay chỉ hit/violation?
- Khi sửa occupancy hoặc override plate, hệ thống phải yêu cầu reason và lưu audit ở mức nào?

## Danh sách nguồn chính thức

1. [Plate Recognizer — Monitor Stream](https://guides.platerecognizer.com/docs/stream/monitoring/)
2. [Plate Recognizer — Webhooks and Output formats for Stream](https://guides.platerecognizer.com/docs/stream/results/)
3. [Plate Recognizer — Configure Stream](https://guides.platerecognizer.com/docs/stream/configuration/)
4. [Plate Recognizer — Webhooks and Output formats for Snapshot](https://guides.platerecognizer.com/docs/snapshot/results/)
5. [Plate Recognizer — ParkPow Dashboard](https://guides.platerecognizer.com/docs/parkpow/user-guide/dashboard/)
6. [Plate Recognizer — ParkPow Parking Management](https://platerecognizer.com/parkpow)
7. [Rekor Scout — Dashboard](https://docs.rekor.ai/scout/scout-dashboard/dashboard)
8. [Rekor Scout — Advanced Search](https://docs.rekor.ai/scout/scout-dashboard/advanced-search)
9. [Rekor Scout — Dispatch Map](https://docs.rekor.ai/scout/scout-dashboard/dispatch-map)
10. [Genetec — Monitoring ALPR events in tile mode](https://techdocs.genetec.com/r/en-US/Security-Center-User-Guide-5.13/Monitoring-ALPR-events-in-tile-mode)
11. [Genetec Web App — Monitoring ALPR hit and read events on maps](https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hit-and-read-events-on-the-Genetec-Web-App)
12. [Genetec Web App — Monitoring ALPR hits](https://techdocs.genetec.com/r/en-US/GenetecTM-Web-App-User-Guide/Monitoring-ALPR-hits-in-the-ALPR-monitoring-task-of-the-Genetec-Web-App)
13. [Milestone — The LPR tab](https://doc.milestonesys.com/xprotect/xprotect-lpr-for-operators/2026r1/en/the-lpr-tab)
14. [Milestone — Validate configuration](https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2025r3/en/validate-configuration)
15. [Milestone — Recognition settings tab](https://doc.milestonesys.com/xprotect/xprotect-lpr-admin-manual/2026r1/en/recognition-settings-tab)
16. [Milestone — XProtect LPR Feature Brief](https://doc.milestonesys.com/latest/en-US/resources/pdfs/mil/featurebriefs/xprotectlprfeaturebrief.pdf)
