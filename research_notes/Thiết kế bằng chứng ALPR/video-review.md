# Thiết kế bằng chứng ALPR và UI xem lại video theo timestamp

Ngày nghiên cứu: 2026-10-21  
Phạm vi: HTML video seeking, timeline markers, WebVTT/cue và cách áp dụng vào React/Vite.

## Kết luận ngắn

- Dùng `HTMLVideoElement.currentTime` làm thời gian chuẩn của phiên xem lại, tính bằng giây trên media timeline. Gán `video.currentTime = t` là cách seek chính xác; `fastSeek()` chỉ phù hợp khi ưu tiên tốc độ hơn độ chính xác.
- Chỉ cho phép người dùng seek trong các khoảng mà `video.seekable` trả về. Với VOD thông thường thường là một khoảng; với stream/live hoặc nguồn bị buffer/expire có thể có nhiều khoảng hoặc không seek được về đầu.
- Dùng `loadedmetadata` để khởi tạo `duration`, kích thước và trạng thái timeline; dùng `timeupdate` cho cập nhật UI thưa như current time. Dùng `seeking`/`seeked` để hiển thị trạng thái đang tải lại frame và tránh coi seek là đã hoàn tất quá sớm.
- WebVTT cue là primitive chuẩn cho dữ liệu gắn với khoảng thời gian. `kind="metadata"` + `TextTrack`/`VTTCue` phù hợp để đồng bộ cue hiện tại với video, nhưng không nên là nguồn dữ liệu duy nhất cho bằng chứng ALPR giàu thuộc tính.
- Marker ALPR nên được lưu như domain data có `mediaTime` riêng, sau đó render bằng lớp UI custom trên timeline. Web platform cung cấp timeline, cue và event; không cung cấp một mô hình marker ALPR/query/filter hoàn chỉnh.
- Trong React, giữ `video` trong `useRef`, đăng ký listener trong `useEffect` và dọn listener khi unmount/đổi nguồn. Không dùng mỗi lần `timeupdate` để render lại toàn bộ danh sách sự kiện lớn.

## 1. Mô hình thời gian và seeking của HTML video

### API nền tảng

`currentTime` là vị trí phát hiện tại tính bằng giây trên media timeline. Khi đặt giá trị mới, trình duyệt bắt đầu seek tới vị trí đó; vị trí cuối cùng có thể được điều chỉnh về điểm mà media thực sự hỗ trợ. `duration` có thể là `NaN` khi chưa có media data và `Infinity` với media không có độ dài hữu hạn, ví dụ live stream.

`seekable` trả về một `TimeRanges` gồm các khoảng mà user agent có thể seek tới. Vì vậy, nút nhảy tới sự kiện phải kiểm tra khoảng seekable thay vì chỉ kiểm tra `0 <= t <= duration`. Nếu sự kiện nằm ngoài vùng hiện có, UI nên báo “không khả dụng trong buffer hiện tại” hoặc tải lại/đổi nguồn theo chiến lược của backend.

Khi đặt `currentTime`, lifecycle chuẩn là:

1. `seeking`: trình duyệt bắt đầu seek.
2. Có thể phát `waiting` nếu chưa có đủ data để tiếp tục.
3. `timeupdate`: vị trí được cập nhật.
4. `seeked`: seek hoàn tất.

`loadedmetadata` là mốc phù hợp để đọc `duration`, kích thước video và chuẩn bị thang thời gian. Không nên lấy `duration` ngay trong lần render đầu rồi giả định nó đã sẵn sàng.

### VOD, stream và live

- VOD đã hoàn tất: có thể dùng `duration` làm mẫu số để đặt marker theo phần trăm.
- Stream/live: `duration` có thể là `Infinity`; không dùng công thức `time / duration`. Dùng các khoảng `seekable`, hiển thị cửa sổ thời gian hiện có và xác định vị trí theo `seekable.start(i)`/`seekable.end(i)`.
- Media timeline có thể không bắt đầu ở 0 hoặc dữ liệu cũ có thể đã hết hạn. Không đồng nhất `recordedAt` ngoài đời với `currentTime`; cần một mapping rõ ràng từ timestamp sự kiện sang media time.

### Quy tắc dữ liệu cho ALPR

Nên tách hai khái niệm:

```ts
type ReviewEvent = {
  id: string;
  mediaTime: number;       // seconds on the selected video timeline
  occurredAt?: string;     // ISO-8601 wall-clock time, if known
  duration?: number;       // seconds; 0 for an instant marker
  plateText?: string;
  confidence?: number;
  cameraId?: string;
  evidenceUrl?: string;
};
```

`mediaTime` phục vụ seek và marker; `occurredAt` phục vụ đối chiếu camera/log/thời gian thực. Ở biên ingest, có thể lưu millisecond integer hoặc decimal/string để tránh sai số khi tính mapping, rồi chỉ chuyển sang `number` (giây) lúc gọi API native của video.

Nếu một clip là đoạn cắt từ recording dài hơn, lưu thêm `sourceOffset` hoặc quy ước rõ `mediaTime` đang tính theo clip hay recording gốc. Đây là điểm quan trọng để bằng chứng không bị lệch sau khi trim/transcode.

## 2. Timeline markers và UI xem lại

### Marker instant và marker khoảng thời gian

Đối với VOD hữu hạn:

```text
ratio = clamp((event.mediaTime - timelineStart) / (timelineEnd - timelineStart), 0, 1)
left  = ratio * 100%
```

Marker “xe đi qua” thường là instant marker. Marker “xe hiện diện/đang theo dõi” nên có `startTime` và `endTime`, render thành một đoạn bar. Nhiều event có thể trùng thời điểm, vì vậy nên gom theo pixel/khung thời gian hoặc dùng stack/lane; đừng cố ép mọi marker vào một chấm duy nhất.

UI đề xuất:

- Thanh scrubber hiển thị `currentTime`, vùng seek được và trạng thái loading.
- Lớp marker tuyệt đối phía trên scrubber, nhận danh sách event đã sort theo `mediaTime`.
- Panel danh sách event dùng cùng `mediaTime`; click event gọi một hàm seek duy nhất.
- Khi seek, highlight event đích sau `seeked`, không chỉ sau click.
- Trên mỗi marker nên có `button`/hit area đủ lớn, `aria-label` gồm biển số, thời gian và loại sự kiện; màu sắc không nên là tín hiệu duy nhất.

Từ các API chuẩn được khảo sát, marker nghiệp vụ ALPR nên là lớp React custom. WebVTT có thể biểu diễn cue theo thời gian, nhưng không thay thế được truy vấn theo camera/biển số/confidence, phân trang, quyền xem hoặc liên kết evidence URL.

### Tần suất cập nhật

- `timeupdate`: dùng cho đồng hồ, vị trí scrubber và highlight event ở độ chính xác UI thông thường. Tần suất do browser/media pipeline quyết định, không nên giả định là mỗi frame.
- `requestVideoFrameCallback()`: dùng khi overlay cần bám frame thực tế, ví dụ bounding box, snapshot hoặc phân tích hình ảnh theo từng frame. API này mới hơn và có thể cần fallback cho browser cũ.
- Không chạy filter/sort toàn bộ event collection ở mỗi `timeupdate`. Giữ event đã sort, tìm event gần nhất bằng binary search hoặc index theo bucket, rồi cập nhật chỉ phần state cần thiết.

## 3. WebVTT, TextTrack và cue

### WebVTT phù hợp với việc gì

Một WebVTT cue có thời điểm bắt đầu, kết thúc và payload. Timestamp dùng độ chính xác tới millisecond; cue được sắp theo thời điểm bắt đầu và có thể chồng lấn trong các trường hợp thông thường. `VTTCue` cho phép tạo cue bằng JavaScript, còn `<track>` cho phép nạp file WebVTT gắn với `<video>`.

Các loại track chuẩn gồm `subtitles`, `captions`, `chapters` và `metadata`. Với ALPR, `metadata` là lựa chọn hợp lý nếu muốn browser tự đánh dấu cue đang active theo playback position mà không hiển thị payload lên video.

Mẫu WebVTT metadata tối giản:

```vtt
WEBVTT ALPR review events

event-123
00:01:12.340 --> 00:01:14.000
{"eventId":"event-123","plateText":"51A12345","confidence":0.94}
```

Payload JSON trong cue là một pattern được W3C mô tả cho metadata track. Trong sản phẩm, cần validate JSON, giới hạn kích thước payload và xử lý cue lỗi; không parse mù dữ liệu đến từ nguồn bên ngoài.

### Đọc cue đang active

`TextTrack.activeCues` là danh sách cue hiện active. `cuechange` phát khi danh sách cue hiện tại thay đổi. Có thể dùng pattern này để đồng bộ “sự kiện hiện tại” khi video chạy, tua hoặc seek. Với cue do app tạo, dùng `video.addTextTrack("metadata", ...)`, đặt mode phù hợp và `track.addCue(new VTTCue(...))`.

Khuyến nghị thực tế:

- Nguồn chuẩn để render danh sách/filter: API/domain JSON của backend.
- WebVTT metadata: lớp đồng bộ tùy chọn, hữu ích khi cần cue theo thời gian, export review package hoặc interop với player khác.
- Không đặt bounding box/evidence binary lớn vào cue; chỉ nên để ID, loại event hoặc payload nhỏ rồi resolve chi tiết từ cache/API.
- Nếu dùng file `<track>`, quản lý lifecycle khi đổi video: đổi `src`, chờ track load/error và không giữ reference cũ sau khi component unmount.

## 4. Áp dụng vào React/Vite

### React boundary

React nên quản lý state hiển thị và domain state; DOM video vẫn là external system:

```ts
const videoRef = useRef<HTMLVideoElement>(null);

useEffect(() => {
  const video = videoRef.current;
  if (!video) return;

  const onLoadedMetadata = () => {
    // Read video.duration, dimensions and seekable ranges here.
  };
  const onTimeUpdate = () => {
    // Publish a lightweight currentTime update.
  };
  const onSeeking = () => {
    // Set a transient seeking/loading state.
  };
  const onSeeked = () => {
    // Reconcile the selected event after the seek completes.
  };

  video.addEventListener("loadedmetadata", onLoadedMetadata);
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("seeking", onSeeking);
  video.addEventListener("seeked", onSeeked);

  return () => {
    video.removeEventListener("loadedmetadata", onLoadedMetadata);
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("seeking", onSeeking);
    video.removeEventListener("seeked", onSeeked);
  };
}, [videoSource]);
```

Đây là khung kiến trúc, không phải thay đổi code của dự án. Các callback cần giữ dependency đúng; nếu dùng React 19 có thể cân nhắc Effect Event cho logic event cần đọc state mới nhất. Với React 18, dùng ref hoặc callback ổn định theo quy ước hiện có của dự án.

Hàm seek tập trung nên:

1. Kiểm tra `Number.isFinite(mediaTime)`.
2. Đọc các range từ `video.seekable`.
3. Clamp hoặc từ chối nếu mục tiêu nằm ngoài range theo policy UX.
4. Gán `video.currentTime`.
5. Để `seeking`/`seeked` quyết định trạng thái loading và thời điểm xác nhận.

### Asset trong Vite

- Nếu video/WebVTT là asset đi cùng frontend và biết trước lúc build, ưu tiên import URL, ví dụ `import trackUrl from "./events.vtt?url"`; Vite sẽ tạo URL phù hợp dev/prod và xử lý hash asset.
- Nếu file cần giữ nguyên tên hoặc do backend/CDN cung cấp, dùng `public/` với đường dẫn gốc hoặc dùng URL runtime từ API. Không ghép chuỗi path giả định thư mục source sau build.
- Nếu deploy dưới base path khác `/`, để Vite xử lý asset URL/import hoặc dùng `import.meta.env.BASE_URL` trong trường hợp URL động.
- Media lớn thường nên nằm trên object storage/CDN/backend streaming; frontend chỉ nhận URL có quyền truy cập và metadata mapping. WebVTT có thể là file riêng hoặc được tạo từ API/export pipeline.

## 5. Kiến trúc đề xuất cho review ALPR

```text
Backend / evidence index
  ├─ video source URL + source start/end
  ├─ ReviewEvent[]: mediaTime, occurredAt, plate, confidence, camera, evidence
  └─ optional WebVTT metadata URL

React review page
  ├─ <video ref={videoRef} />
  ├─ player adapter: duration, currentTime, seekable, seeking/seeked
  ├─ custom timeline: progress + marker lanes + keyboard/ARIA
  ├─ event list/filter: domain data, not cue payload
  └─ optional metadata-track adapter: cuechange/activeCues
```

Nên cô lập browser API trong một hook/adapter nhỏ, chẳng hạn `useVideoReviewController`, để phần timeline không phụ thuộc trực tiếp vào `HTMLMediaElement`. Điều này giúp test được các trường hợp `duration = NaN/Infinity`, nhiều `TimeRanges`, seek thất bại và đổi source.

### Checklist nghiệm thu

- [ ] Click event seek đúng `mediaTime` và highlight sau `seeked`.
- [ ] `loadedmetadata`/`durationchange` cập nhật đúng duration; không chia cho 0, `NaN` hoặc `Infinity`.
- [ ] Marker ngoài `seekable` được hiển thị là unavailable hoặc có policy tải lại rõ ràng.
- [ ] Event instant và event duration không bị chồng lấn làm mất khả năng click.
- [ ] Tua nhanh liên tục không tạo hàng đợi state lỗi thời; event mới nhất thắng.
- [ ] Đổi camera/video dọn listener, cue và marker của source cũ.
- [ ] Keyboard, focus, tooltip và màu tương phản đủ cho review vận hành.
- [ ] Nếu hiển thị bounding box, kiểm tra scale/crop/letterbox giữa `videoWidth`/`videoHeight` và kích thước CSS.
- [ ] URL media/WebVTT, CORS, auth expiry và quyền truy cập evidence được kiểm thử trong môi trường deploy thật.

## Nguồn chính thống

1. WHATWG HTML Standard — Media elements, current playback position, seeking, `seekable`, `seeking`, `seeked`:  
   https://html.spec.whatwg.org/multipage/media.html
2. MDN — `HTMLMediaElement`: properties và events (`duration`, `currentTime`, `seekable`, `timeupdate`, `seeking`, `seeked`):  
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
3. MDN — `HTMLMediaElement.currentTime`:  
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime
4. MDN — `loadedmetadata` event:  
   https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadedmetadata_event
5. MDN — Audio/video delivery, seeking và `TimeRanges`:  
   https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery
6. W3C — WebVTT: The Web Video Text Tracks Format, cue timing và `VTTCue`:  
   https://www.w3.org/TR/webvtt1/
7. MDN — WebVTT API (`TextTrack`, `VTTCue`, `addCue`, metadata track):  
   https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API
8. MDN — `<track>` element, `kind="metadata"` và `cuechange`:  
   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track
9. MDN — `TextTrack: cuechange` event và `activeCues`:  
   https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/cuechange_event
   https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/activeCues
10. W3C Wiki — VTT Concepts, ví dụ metadata track chứa JSON và đồng bộ DOM theo cue:  
    https://www.w3.org/wiki/VTT_Concepts
11. MDN — `HTMLVideoElement.requestVideoFrameCallback()`:  
    https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
12. React — Synchronizing with Effects, điều khiển `<video>` qua ref và effect cleanup:  
    https://react.dev/learn/synchronizing-with-effects
13. React — `useEffect` reference:  
    https://react.dev/reference/react/useEffect
14. Vite — Static Asset Handling, import URL, `?url`, `public/` và base path:  
    https://vite.dev/guide/assets
15. Vite — Building for Production, public base path:  
    https://vite.dev/guide/build

## Lưu ý về mức độ chuẩn hóa

Các phần về `currentTime`, `seekable`, event lifecycle, WebVTT và `TextTrack` dựa trên WHATWG/ W3C/MDN. Các khuyến nghị về model `ReviewEvent`, marker lanes, binary search, hook/adapter và cách phân tách domain data với cue là kết luận thiết kế áp dụng cho hệ thống React/Vite, suy ra từ các primitive đó; chúng không phải một API chuẩn bắt buộc.
