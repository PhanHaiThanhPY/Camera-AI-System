"""Mô phỏng 4 luồng camera cho từng cơ sở — phát qua WebRTC (aiortc) nên độ trễ thấp, phát được
trên trình duyệt cho mọi loại nguồn (http/https, rtsp, hoặc cả file cục bộ) vì khung hình được đọc
bằng OpenCV ở phía máy chủ rồi gửi qua WebRTC, không phụ thuộc trình duyệt có hỗ trợ giao thức gốc
của link hay không.

Mỗi cơ sở (mỏ đá / mỏ cát / cơ sở bê tông) có 4 màn hình ứng với "4 góc" camera quen thuộc
(C1 toàn cảnh vào, C2 cận cảnh vào, C3 toàn cảnh ra, C4 cận cảnh ra). Mỗi màn hình có một ô nhập
link stream. Link lưu vào links.json cạnh file này.

Cài đặt: pip install aiortc aiohttp opencv-python-headless pillow (đã có trong python/requirements.txt)
Chạy:    python python/streamsim/server.py [--host 0.0.0.0] [--port 8800]
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import resource
import sys
import threading
import time
from pathlib import Path
from string import Template
from threading import Lock

# Phải đặt TRƯỚC khi cv2 mở bất kỳ luồng RTSP nào: một số server RTSP (ví dụ Wowza Cloud) chỉ nhận
# transport TCP và trả lỗi "461 Unsupported Transport" nếu OpenCV/FFmpeg tự chọn UDP. Không ảnh hưởng
# nguồn http/https/file. Đặt STREAMSIM_RTSP_TRANSPORT=udp nếu server của bạn ngược lại chỉ nhận UDP.
if "OPENCV_FFMPEG_CAPTURE_OPTIONS" not in os.environ:
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{os.environ.get('STREAMSIM_RTSP_TRANSPORT', 'tcp')}"

import cv2
import numpy as np
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
LINKS_FILE = ROOT / "links.json"
LINKS_LOCK = Lock()
PLACEHOLDER_SIZE = (640, 360)
# Mỗi lần mở nguồn chờ tối đa chừng này rồi coi là lỗi, để thử lại nhanh thay vì treo 30s mặc định của FFmpeg.
CAPTURE_TIMEOUT_MSEC = int(os.environ.get("STREAMSIM_CAPTURE_TIMEOUT_MSEC", "8000"))

SITES = [
    {"key": "mo-da", "label": "Mỏ đá"},
    {"key": "mo-cat", "label": "Mỏ cát"},
    {"key": "be-tong", "label": "Cơ sở bê tông"},
]
CAMERAS = [
    {"key": "c1", "label": "C1 · Toàn cảnh vào"},
    {"key": "c2", "label": "C2 · Cận cảnh vào"},
    {"key": "c3", "label": "C3 · Toàn cảnh ra"},
    {"key": "c4", "label": "C4 · Cận cảnh ra"},
]
SITE_KEYS = {site["key"] for site in SITES}
CAMERA_KEYS = [camera["key"] for camera in CAMERAS]

PAGE_TEMPLATE = Template("""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mô phỏng stream camera</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column; background: #ffffff; color: #0f1c3f; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { flex: 0 0 auto; padding: 18px 24px 4px; }
  header h1 { margin: 0 0 4px; font-size: 19px; }
  header p { margin: 0; color: #5b6b85; font-size: 12px; line-height: 1.5; }
  form.site-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 10px 24px; }
  .site-bar label { font-size: 13px; color: #5b6b85; }
  select { background: #f3f5f9; color: #0f1c3f; border: 1px solid #d7dee8; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
  .links { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 16px; box-sizing: border-box; }
  .grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 12px; }
  .tile { display: flex; flex-direction: column; min-height: 0; background: #f3f5f9; border-radius: 12px; overflow: hidden; border: 1px solid #d7dee8; }
  .frame { flex: 1 1 auto; min-height: 0; background: #000; position: relative; }
  .frame video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .empty { position: absolute; inset: 0; background: #000; color: #8a94a6; font-size: 13px; text-align: center; padding: 12px; line-height: 1.6; display: flex; align-items: center; justify-content: center; }
  .tile-body { flex: 0 0 auto; padding: 10px 14px 12px; }
  .caption { margin: 0 0 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #5b6b85; }
  .tile-row { display: flex; gap: 8px; }
  .tile-row input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; background: #fff; color: #0f1c3f; border: 1px solid #d7dee8; border-radius: 7px; padding: 8px 10px; font-size: 12px; font-family: "SF Mono", Menlo, monospace; }
  button { flex: 0 0 auto; background: #2f5fdb; color: #fff; border: 0; border-radius: 8px; padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer; }
  button:hover { background: #2347ad; }
  .status { margin: 6px 0 0; min-height: 14px; color: #5b6b85; font-size: 11px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; grid-template-rows: repeat(4, minmax(220px, 1fr)); } }
</style>
</head>
<body>
<header>
  <h1>Mô phỏng stream camera</h1>
  <p>Dán link cho từng góc camera rồi bấm Lưu &amp; phát ở đúng ô đó — mỗi góc cập nhật và kết nối lại độc lập, không ảnh hưởng 3 góc còn lại. Phát qua WebRTC nên dùng được cả link http/https, rtsp hay đường dẫn file.</p>
</header>
<form class="site-bar" method="get" action="/">
  <label for="site">Cơ sở</label>
  <select id="site" name="site" onchange="this.form.submit()">$site_options</select>
</form>
<div class="links">
  <div class="grid">
$tiles
  </div>
</div>
<script>
const peers = {};

function setOverlay(camera, text) {
  const el = document.getElementById('empty-' + camera);
  if (el === null) return;
  if (text === null) { el.style.display = 'none'; }
  else { el.textContent = text; el.style.display = 'flex'; }
}

function stopStream(camera) {
  const pc = peers[camera];
  if (pc) { try { pc.close(); } catch (e) { /* đã đóng rồi, bỏ qua */ } delete peers[camera]; }
  const videoEl = document.getElementById('video-' + camera);
  if (videoEl !== null) { videoEl.srcObject = null; }
}

async function startStream(site, camera) {
  stopStream(camera);
  const videoEl = document.getElementById('video-' + camera);
  if (videoEl === null) return;
  setOverlay(camera, 'Đang kết nối…');
  const pc = new RTCPeerConnection();
  peers[camera] = pc;
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (event) => { videoEl.srcObject = event.streams[0]; setOverlay(camera, null); };
  pc.onconnectionstatechange = () => {
    if (peers[camera] === pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
      setOverlay(camera, 'Mất kết nối WebRTC');
    }
  };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const check = () => {
      if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
  let response;
  try {
    response = await fetch('/webrtc/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type, site: site, camera: camera })
    });
  } catch (e) {
    setOverlay(camera, 'Không gọi được máy chủ');
    return;
  }
  const answer = await response.json();
  if (peers[camera] !== pc) { return; }  // đã bấm Lưu & phát lần nữa trong lúc chờ — bỏ kết quả cũ.
  if (answer.error) { setOverlay(camera, answer.error); return; }
  await pc.setRemoteDescription(answer);
}

async function updateLink(site, camera) {
  const input = document.getElementById('input-' + camera);
  const statusEl = document.getElementById('status-' + camera);
  const link = input.value.trim();
  if (statusEl !== null) statusEl.textContent = 'Đang lưu…';
  try {
    const response = await fetch('/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: site, camera: camera, link: link })
    });
    if (!response.ok) { throw new Error('HTTP ' + response.status); }
  } catch (e) {
    if (statusEl !== null) statusEl.textContent = 'Lưu lỗi: ' + e.message;
    return;
  }
  if (statusEl !== null) statusEl.textContent = 'Đã lưu.';
  if (link === '') { stopStream(camera); setOverlay(camera, 'Chưa có link'); } else { startStream(site, camera); }
}

const SITE = '$site';
const LINKS = $links_json;
for (const camera of Object.keys(LINKS)) {
  if (LINKS[camera]) { startStream(SITE, camera); }
}
</script>
</body>
</html>
""")

TILE_TEMPLATE = Template("""    <div class="tile">
      <div class="frame">
        <video id="video-$key" autoplay playsinline muted></video>
        <div class="empty" id="empty-$key">$empty_text</div>
      </div>
      <div class="tile-body">
        <p class="caption">$label</p>
        <div class="tile-row">
          <input type="text" id="input-$key" value="$value" placeholder="https://... hoặc rtsp://..." />
          <button type="button" onclick="updateLink('$site', '$key')">Lưu &amp; phát</button>
        </div>
        <p class="status" id="status-$key"></p>
      </div>
    </div>""")


def load_links() -> dict[str, dict[str, str]]:
    with LINKS_LOCK:
        if not LINKS_FILE.exists():
            return {}
        try:
            return json.loads(LINKS_FILE.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}


def save_site_links(site: str, links: dict[str, str]) -> None:
    with LINKS_LOCK:
        all_links = {}
        if LINKS_FILE.exists():
            try:
                all_links = json.loads(LINKS_FILE.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                all_links = {}
        all_links[site] = links
        LINKS_FILE.write_text(json.dumps(all_links, ensure_ascii=False, indent=2), "utf-8")


def normalize_site(value: str | None) -> str:
    return value if value in SITE_KEYS else SITES[0]["key"]


def render_page(selected_site: str) -> str:
    all_links = load_links()
    site_links = all_links.get(selected_site, {})

    site_options = "".join(
        f'<option value="{site["key"]}"{" selected" if site["key"] == selected_site else ""}>{html.escape(site["label"])}</option>'
        for site in SITES
    )

    tiles = []
    for camera in CAMERAS:
        link = site_links.get(camera["key"], "")
        empty_text = "Chưa có link" if link == "" else "Đang kết nối…"
        tiles.append(TILE_TEMPLATE.substitute(
            site=selected_site, label=html.escape(camera["label"]), key=camera["key"], value=html.escape(link), empty_text=empty_text
        ))

    # Nhúng vào <script> — JSON không html-escape, chỉ chặn "</" để không lỡ đóng sớm thẻ <script>.
    links_json = json.dumps({key: site_links.get(key, "") for key in CAMERA_KEYS}, ensure_ascii=False).replace("</", "<\\/")

    return PAGE_TEMPLATE.substitute(
        site_options=site_options,
        site=selected_site,
        tiles="\n".join(tiles),
        links_json=links_json
    )


# --- Đọc khung hình & phát qua WebRTC ---------------------------------------------------------


def placeholder_frame(text: str) -> np.ndarray:
    image = Image.new("RGB", PLACEHOLDER_SIZE, color=(15, 23, 42))
    draw = ImageDraw.Draw(image)
    draw.text((24, PLACEHOLDER_SIZE[1] // 2 - 8), text, fill=(148, 163, 184))
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


class CameraTrack(VideoStreamTrack):
    """Đọc khung hình từ `source` (http/https, rtsp, hoặc file) trong một luồng nền riêng — tránh
    chặn event loop của aiortc vì cv2.VideoCapture.read() là lệnh gọi đồng bộ (blocking). recv() chỉ
    lấy khung mới nhất đã đọc được, không tự chờ I/O."""

    kind = "video"

    def __init__(self, source: str) -> None:
        super().__init__()
        self._source = source
        self._lock = threading.Lock()
        self._frame = placeholder_frame("Đang kết nối…")
        self._live = False
        self._stopped = False
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    @property
    def source(self) -> str:
        return self._source

    @property
    def live(self) -> bool:
        """True khi đang nhận khung hình thật từ nguồn (không phải khung báo trạng thái)."""
        return self._live

    def _read_loop(self) -> None:
        while not self._stopped:
            capture = cv2.VideoCapture(self._source, cv2.CAP_FFMPEG)
            capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, CAPTURE_TIMEOUT_MSEC)
            capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, CAPTURE_TIMEOUT_MSEC)
            if not capture.isOpened():
                with self._lock:
                    self._frame = placeholder_frame("Không mở được nguồn")
                    self._live = False
                capture.release()
                time.sleep(3)
                continue
            while not self._stopped:
                ok, frame = capture.read()
                if not ok:
                    break
                with self._lock:
                    self._frame = frame
                    self._live = True
            capture.release()
            if not self._stopped:
                with self._lock:
                    self._frame = placeholder_frame("Mất tín hiệu, đang thử lại…")
                    self._live = False
                time.sleep(2)

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()
        with self._lock:
            frame = self._frame
        video_frame = VideoFrame.from_ndarray(frame, format="bgr24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    def stop(self) -> None:
        self._stopped = True
        super().stop()


# --- aiohttp: trang web + ký hiệu (signaling) WebRTC ------------------------------------------

START_TIME = time.time()
active_peers: set[RTCPeerConnection] = set()
active_tracks: dict[RTCPeerConnection, CameraTrack] = {}


async def close_peer(pc: RTCPeerConnection) -> None:
    active_peers.discard(pc)
    track = active_tracks.pop(pc, None)
    if track is not None:
        track.stop()
    await pc.close()


async def handle_index(request: web.Request) -> web.Response:
    site = normalize_site(request.query.get("site"))
    return web.Response(text=render_page(site), content_type="text/html")


async def handle_update_link(request: web.Request) -> web.Response:
    """Cập nhật link của MỘT camera trong MỘT cơ sở — không đụng tới 3 camera còn lại."""
    try:
        params = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Body phải là JSON."}, status=400)

    site = normalize_site(params.get("site"))
    camera = params.get("camera")
    if camera not in CAMERA_KEYS:
        return web.json_response({"error": "camera không hợp lệ."}, status=400)

    link = str(params.get("link", "")).strip()
    current = load_links().get(site, {})
    links = {key: current.get(key, "") for key in CAMERA_KEYS}
    links[camera] = link
    save_site_links(site, links)
    return web.json_response({"ok": True, "site": site, "camera": camera, "link": link})


async def handle_offer(request: web.Request) -> web.Response:
    try:
        params = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Body phải là JSON."}, status=400)

    site = normalize_site(params.get("site"))
    camera = params.get("camera")
    if camera not in CAMERA_KEYS:
        return web.json_response({"error": "camera không hợp lệ."}, status=400)
    if "sdp" not in params or "type" not in params:
        return web.json_response({"error": "Thiếu sdp/type."}, status=400)

    link = load_links().get(site, {}).get(camera, "")
    if link == "":
        return web.json_response({"error": "Chưa có link cho camera này."}, status=404)

    pc = RTCPeerConnection()
    active_peers.add(pc)
    track = CameraTrack(link)
    active_tracks[pc] = track
    pc.addTrack(track)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange() -> None:
        if pc.connectionState in ("failed", "closed", "disconnected"):
            await close_peer(pc)

    await pc.setRemoteDescription(RTCSessionDescription(sdp=params["sdp"], type=params["type"]))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.json_response({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type})


async def on_shutdown(_app: web.Application) -> None:
    await asyncio.gather(*(close_peer(pc) for pc in list(active_peers)))


def process_memory_mb() -> float:
    """Đỉnh RSS của tiến trình. ru_maxrss đơn vị khác nhau theo hệ điều hành: byte trên macOS, KB trên Linux."""
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_bytes = peak if sys.platform == "darwin" else peak * 1024
    return round(peak_bytes / 1024 / 1024, 1)


async def handle_health(_request: web.Request) -> web.Response:
    """Đo tải cơ bản của streamsim — số luồng WebRTC đang mở, nguồn từng luồng, CPU/RAM tiến trình."""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    streams = [
        {"source": track.source, "connectionState": pc.connectionState, "receivingFrames": track.live}
        for pc, track in active_tracks.items()
    ]
    return web.json_response({
        "status": "ok",
        "uptimeSeconds": round(time.time() - START_TIME),
        "activeStreams": len(streams),
        "streams": streams,
        "memory": {"peakRssMb": process_memory_mb()},
        "cpuSeconds": {"user": round(usage.ru_utime, 1), "system": round(usage.ru_stime, 1)}
    })


def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_post("/link", handle_update_link)
    app.router.add_post("/webrtc/offer", handle_offer)
    app.router.add_get("/health", handle_health)
    app.on_shutdown.append(on_shutdown)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Mô phỏng stream camera (WebRTC) cho dashboard/pipeline — chỉ dùng cho demo/dev, không bật ra Internet.")
    parser.add_argument("--host", default="0.0.0.0", help="Mặc định 0.0.0.0 để máy khác trong mạng LAN xem/dùng được.")
    parser.add_argument("--port", type=int, default=8800)
    args = parser.parse_args()

    print(f"Mô phỏng stream camera (WebRTC) chạy tại http://{args.host}:{args.port} — Ctrl+C để dừng.")
    print(f"Link nhập trên trang được lưu vào {LINKS_FILE}.")
    web.run_app(build_app(), host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
