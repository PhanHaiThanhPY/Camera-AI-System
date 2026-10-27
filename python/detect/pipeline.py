"""Chụp 1 camera theo tín hiệu cân: cân xong mới chụp, chụp xong mới nhận diện.

Mỗi tiến trình (= 1 camera) giữ một kết nối video/RTSP sống (grab() liên tục, rẻ, không decode —
để luồng luôn "tươi" và chịu được reconnect như RTSP thật cần), đồng thời polling định kỳ
`GET {GATE_API_URL}/gate/capture-requests/pending?scaleId=...` để biết trạm cân của mình vừa
cân xong chưa. Có đợt chờ đang mở: lấy khung hình HIỆN TẠI (retrieve()), chạy YOLO biển số +
RapidOCR + model xe/vật liệu một lần trên đúng khung đó (xe đang đứng yên trên cân nên khung này
thường nét hơn một khung bất kỳ giữa lúc xe chạy), rồi POST kết quả tới
`{GATE_API_URL}/gate/passes/{passId}/capture-result` (xem apps/api/src/gate/gate.controller.ts).
Ảnh mờ (Laplacian variance dưới CAPTURE_BLUR_MIN_VARIANCE) hoặc không thấy biển số thì vẫn báo
kết quả nhưng đánh `quality` tương ứng để apps/api biết — đủ 4 camera (hoặc hết giờ chờ) mà không
camera nào đọc được biển thì lượt xe chuyển trạng thái "cần kiểm tra lại" (CAPTURE_FAILED).

Bản cũ chạy liên tục suốt video (xem git history) đã bỏ hẳn theo đúng luồng nghiệp vụ mới — không
còn tracking/bình chọn biển số qua nhiều khung hình, vì mỗi lần cân chỉ chụp đúng một khung.

`<input>` là đường dẫn file video hoặc URL luồng (rtsp://, http://...) — cv2.VideoCapture nhận cả
hai như nhau, nên script này chạy được cho cả file test lẫn camera sống không cần sửa gì thêm.
"""

from __future__ import annotations

import json
import os
import re
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request

# Phải đặt TRƯỚC khi cv2 mở bất kỳ luồng RTSP nào — giống python/streamsim/server.py: một số server RTSP
# (và cv2/FFmpeg mặc định có thể chọn UDP) sẽ treo tới khi hết timeout mở luồng (thường ~30s) rồi mới báo
# lỗi thay vì kết nối. Đặt STREAMSIM_RTSP_TRANSPORT=udp nếu server của bạn ngược lại chỉ nhận UDP. Không
# ảnh hưởng nguồn http/https/file.
if "OPENCV_FFMPEG_CAPTURE_OPTIONS" not in os.environ:
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{os.environ.get('STREAMSIM_RTSP_TRANSPORT', 'tcp')}"
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
# Biển số Việt Nam: 2 số tỉnh + 1–2 chữ + 4–6 số (biển xe máy, ô tô, xe công).
PLATE_PATTERN = re.compile(os.getenv("LPR_PLATE_REGEX", r"^\d{2}[A-Z]{1,2}\d{4,6}$"))
VEHICLE_CLASSES = {"car": "car", "motorcycle": "motorcycle", "bus": "bus", "truck": "truck"}

Box = tuple[int, int, int, int]

# SIGTERM: thoát vòng đọc frame, chốt các xe đang theo dõi rồi trả kết quả.
STOP_REQUESTED = False


def request_stop(_signum: int, _frame: Any) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def env_float(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


def resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def normalize_plate(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def format_plate(value: str) -> str:
    if re.fullmatch(r"\d{2}[A-Z]\d{5}", value):
        return f"{value[:3]}-{value[3:6]}.{value[6:]}"
    if re.fullmatch(r"\d{2}[A-Z]\d{4}", value):
        return f"{value[:3]}-{value[3:]}"
    return value


# --- OCR -------------------------------------------------------------------------------------


def read_ocr_text(ocr_engine: Any, crop: Any) -> tuple[str, float]:
    """Đọc biển số, ghép biển 2 dòng theo thứ tự dòng trên → dưới, trái → phải."""
    candidates: list[tuple[float, float, str, float]] = []
    ocr_result = ocr_engine(crop)

    if isinstance(ocr_result, tuple):
        items = ocr_result[0] or []
        entries = [(item[0], str(item[1]), item[2]) for item in items if len(item) >= 3]
    else:
        boxes = list(getattr(ocr_result, "boxes", None) if getattr(ocr_result, "boxes", None) is not None else [])
        texts = list(getattr(ocr_result, "txts", None) or [])
        scores = list(getattr(ocr_result, "scores", None) or [])
        entries = [(boxes[i] if i < len(boxes) else [], str(texts[i]), scores[i]) for i in range(min(len(texts), len(scores)))]

    for box, raw_text, raw_score in entries:
        text = normalize_plate(raw_text)
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        if text:
            x = min((float(p[0]) for p in box), default=0.0)
            y = min((float(p[1]) for p in box), default=0.0)
            candidates.append((y, x, text, score))

    if not candidates:
        return "", 0.0
    # Biển 2 dòng: gom theo dòng (y gần nhau) rồi sắp trái → phải.
    heights = [c[0] for c in candidates]
    line_gap = (max(heights) - min(heights)) / 2 if len(candidates) > 1 else 0
    candidates.sort(key=lambda c: (round(c[0] / line_gap) if line_gap > 4 else 0, c[1]))
    text = normalize_plate("".join(c[2] for c in candidates))
    return text, round(sum(c[3] for c in candidates) / len(candidates), 4)


def ocr_plate(cv2: Any, ocr_engine: Any, frame: Any, box: Box) -> tuple[str, float]:
    """Cắt biển có đệm, phóng to cho biển nhỏ rồi OCR."""
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = box
    pad_x, pad_y = int((x2 - x1) * 0.08), int((y2 - y1) * 0.15)
    crop = frame[max(y1 - pad_y, 0) : min(y2 + pad_y, height), max(x1 - pad_x, 0) : min(x2 + pad_x, width)]
    if crop.size == 0:
        return "", 0.0
    target_width = 240
    if crop.shape[1] < target_width:
        scale = target_width / crop.shape[1]
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return read_ocr_text(ocr_engine, crop)


# --- Hình học (chỉ dùng nội bộ để cắt vùng phân loại, không xuất ra ngoài) -------------------


def clamp_box(box: tuple[float, float, float, float], frame_size: tuple[int, int]) -> Box:
    width, height = frame_size
    x1, y1, x2, y2 = box
    return (
        int(min(max(x1, 0), width - 1)),
        int(min(max(y1, 0), height - 1)),
        int(min(max(x2, 1), width)),
        int(min(max(y2, 1), height)),
    )


def estimate_vehicle_box(plate_box: Box, frame_size: tuple[int, int]) -> Box:
    """Dự phòng khi model xe không thấy xe: ước lượng từ biển (biển ≈ 1/5 thân xe, nằm gần đáy xe)."""
    x1, y1, x2, y2 = plate_box
    center_x = (x1 + x2) / 2
    plate_width, plate_height = max(x2 - x1, 1), max(y2 - y1, 1)
    vehicle_width = plate_width * env_float("VEHICLE_WIDTH_PLATE_RATIO", 5)
    bottom = y2 + plate_height * 1.2
    return clamp_box((center_x - vehicle_width / 2, bottom - vehicle_width * 0.8, center_x + vehicle_width / 2, bottom), frame_size)


def detect_vehicle(model: Any | None, frame: Any, plate_box: Box) -> tuple[Box, str, float] | None:
    """Xe nhỏ nhất chứa tâm biển số (COCO car/motorcycle/bus/truck) → (box, mã loại xe, độ tin cậy)."""
    if model is None:
        return None
    center_x, center_y = (plate_box[0] + plate_box[2]) / 2, (plate_box[1] + plate_box[3]) / 2
    best: tuple[float, Box, str, float] | None = None
    result = model(frame, conf=0.25, verbose=False)[0]
    if result.boxes is None:
        return None
    for coordinates, class_id, score in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.cls.cpu().tolist(), result.boxes.conf.cpu().tolist()):
        code = VEHICLE_CLASSES.get(str(result.names[int(class_id)]))
        x1, y1, x2, y2 = coordinates
        if code is not None and x1 <= center_x <= x2 and y1 <= center_y <= y2:
            area = (x2 - x1) * (y2 - y1)
            if best is None or area < best[0]:
                best = (area, (int(x1), int(y1), int(x2), int(y2)), code, float(score))
    return (best[1], best[2], best[3]) if best is not None else None


# --- Phân loại loại đá (zero-shot) -----------------------------------------------------------

# Mô tả để CLIP so khớp với vùng hàng. Mã trùng danh mục trong gate.catalog.ts; "not_cargo" = không phải thùng hàng.
MATERIAL_PROMPTS = {
    "sand": "a truck bed filled with fine construction sand, visible fine grains",
    "stone_2_3": "a dump truck bed filled with 2 to 3 centimeter aggregate stones",
    "stone_4_6": "a dump truck bed filled with 4 to 6 centimeter crushed stones",
    "boulder": "a dump truck bed carrying large boulders, large rock blocks",
    "empty": "an empty truck bed with no cargo",
    "not_cargo": "the front of a passenger car",
}


class MaterialClassifier:
    """Phân loại loại đá bằng CLIP zero-shot khi chưa có model huấn luyện riêng.

    Chỉ là ước lượng theo hình dạng/kích cỡ hạt đá; độ tin cậy dưới MATERIAL_MIN_CONF thì trả "chưa xác định".
    Thay bằng model huấn luyện trên dữ liệu của mỏ (MATERIAL_MODEL_PATH, xem python/train) để chính xác hơn.
    """

    def __init__(self) -> None:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        name = os.getenv("MATERIAL_CLIP_MODEL", "openai/clip-vit-base-patch32")
        self.torch = torch
        self.model = CLIPModel.from_pretrained(name).eval()
        self.processor = CLIPProcessor.from_pretrained(name)
        self.min_conf = env_float("MATERIAL_MIN_CONF", 0.5)

    def classify(self, bgr_image: Any) -> dict[str, Any]:
        from PIL import Image

        image = Image.fromarray(bgr_image[:, :, ::-1])
        inputs = self.processor(text=list(MATERIAL_PROMPTS.values()), images=image, return_tensors="pt", padding=True)
        with self.torch.no_grad():
            probs = self.model(**inputs).logits_per_image.softmax(-1)[0].tolist()
        scores = dict(zip(MATERIAL_PROMPTS, probs))
        code = max(scores, key=scores.get)  # type: ignore[arg-type]
        confidence = round(float(scores[code]), 4)
        if code == "not_cargo":
            return {"code": None, "confidence": confidence, "source": "unavailable", "notCargo": confidence >= 0.8}
        if confidence < self.min_conf:
            return {"code": None, "confidence": confidence, "source": "unavailable", "notCargo": False}
        return {"code": code, "confidence": confidence, "source": "zero-shot", "notCargo": False}


# --- Pipeline: chờ tín hiệu cân rồi chụp 1 lần -----------------------------------------------


class Pipeline:
    def __init__(self, camera_id: str, scale_id: str) -> None:
        import cv2
        from ultralytics import YOLO

        try:
            from rapidocr import RapidOCR
        except ImportError:
            from rapidocr_onnxruntime import RapidOCR

        from storage import ImageUploader

        self.cv2 = cv2
        self.camera_id = camera_id
        self.scale_id = scale_id
        self.storage = ImageUploader()
        self.api_base = os.getenv("GATE_API_URL", "").strip().rstrip("/")
        if self.api_base == "":
            raise RuntimeError("Cần đặt GATE_API_URL — mode chụp theo tín hiệu cân phải polling apps/api để biết lúc nào cần chụp.")

        plate_model = resolve_path(os.getenv("LPR_MODEL_PATH", "python/models/license-plate-detector.pt"))
        if not plate_model.exists():
            raise RuntimeError(f"Không tìm thấy model biển số tại {plate_model}. Xem python/models/README.md để tải.")
        self.plate_detector = YOLO(str(plate_model))
        self.ocr = RapidOCR()
        vehicle_model = resolve_path(os.getenv("VEHICLE_DET_MODEL_PATH", "python/models/yolov8n.pt"))
        self.vehicle_detector = YOLO(str(vehicle_model)) if vehicle_model.exists() else None
        material_path = os.getenv("MATERIAL_MODEL_PATH", "")
        self.material_model = YOLO(str(resolve_path(material_path))) if material_path else None
        self.material_zero_shot: MaterialClassifier | None = None
        if self.material_model is None and os.getenv("MATERIAL_ZERO_SHOT", "false").lower() == "true":
            try:
                self.material_zero_shot = MaterialClassifier()
            except (ImportError, OSError) as error:
                print(f"Material classifier unavailable; continuing without it: {error}", file=sys.stderr)

        self.confidence = env_float("LPR_CONFIDENCE", 0.3)
        self.min_detector = env_float("LPR_MIN_DETECTOR_CONF", 0.4)
        self.imgsz = int(env_float("LPR_IMGSZ", 1280))
        self.min_ocr = env_float("LPR_MIN_OCR", 0.5)
        self.load_fraction = env_float("LOAD_REGION_TOP_FRACTION", 0.5)
        # Mỗi bao nhiêu giây hỏi apps/api xem trạm cân của mình vừa cân xong chưa (rẻ, chỉ 1 request JSON nhỏ).
        self.poll_seconds = env_float("CAPTURE_POLL_SECONDS", 1.0)
        # Laplacian variance dưới ngưỡng này coi là ảnh mờ (quality="blurry"), dù có đọc được chữ hay không.
        self.blur_min_variance = env_float("CAPTURE_BLUR_MIN_VARIANCE", 60.0)

    def capture_once(self, frame: Any, size: tuple[int, int]) -> dict[str, Any]:
        """Chạy nhận diện MỘT LẦN trên khung hình hiện tại lúc có tín hiệu chụp — không tracking/bình chọn
        qua nhiều khung hình như bản continuous cũ, vì xe đứng yên trên cân nên một khung đã đủ để đọc."""
        best: tuple[float, Box, str, float, float] | None = None  # score, box, text, ocr, det
        result = self.plate_detector(frame, conf=self.confidence, imgsz=self.imgsz, verbose=False)[0]
        if result.boxes is not None:
            for coordinates, det in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist()):
                box = clamp_box(tuple(coordinates), size)  # type: ignore[arg-type]
                if box[2] - box[0] < 12 or box[3] - box[1] < 6:
                    continue
                text, ocr = ocr_plate(self.cv2, self.ocr, frame, box)
                if not PLATE_PATTERN.match(text):
                    continue
                score = ocr * float(det)
                if best is None or score > best[0]:
                    best = (score, box, text, ocr, float(det))

        # Luôn chụp + lưu ảnh làm bằng chứng, kể cả khi không đọc được biển — người vận hành cần ảnh thật để
        # kiểm tra lại tay (xem có đúng là mờ/che khuất không, hay model bỏ sót một biển số đọc được bằng mắt).
        if best is None:
            # Không thấy biển số nào trong khung — chụp cả khung làm bằng chứng, không có vùng xe để khoanh riêng.
            image_url = self.capture_image(frame, (0, 0, size[0], size[1]))
            return {"cameraId": self.camera_id, "plateNumber": None, "ocrConfidence": None, "detectorConfidence": None, "imageUrl": image_url, "quality": "no_plate"}

        _, plate_box, text, ocr_score, det_score = best
        vehicle = detect_vehicle(self.vehicle_detector, frame, plate_box)
        if vehicle is not None:
            vehicle_box, vehicle_code, vehicle_conf = vehicle
            vehicle_type = {"code": vehicle_code, "confidence": round(vehicle_conf, 4), "source": "model"}
        else:
            vehicle_box = estimate_vehicle_box(plate_box, size)
            vehicle_type = {"code": None, "confidence": None, "source": "unavailable"}
        image_url = self.capture_image(frame, vehicle_box)

        if ocr_score < self.min_ocr or det_score < self.min_detector:
            return {"cameraId": self.camera_id, "plateNumber": None, "ocrConfidence": round(ocr_score, 4), "detectorConfidence": round(det_score, 4), "imageUrl": image_url, "quality": "no_plate"}
        if self._is_blurry(frame, plate_box):
            return {
                "cameraId": self.camera_id,
                "plateNumber": format_plate(text),
                "ocrConfidence": round(ocr_score, 4),
                "detectorConfidence": round(det_score, 4),
                "imageUrl": image_url,
                "quality": "blurry",
            }

        # Chỉ xe tải mới có thùng hàng để phân loại vật liệu.
        material: dict[str, Any] = {"code": None, "confidence": None, "source": "unavailable"}
        if vehicle_type["code"] == "truck":
            load_box = clamp_box(
                (vehicle_box[0], vehicle_box[1], vehicle_box[2], vehicle_box[1] + (vehicle_box[3] - vehicle_box[1]) * self.load_fraction), size
            )
            load_crop = frame[load_box[1] : load_box[3], load_box[0] : load_box[2]]
            if self.material_model is not None:
                result = self.material_model(load_crop, verbose=False)[0]
                if getattr(result, "probs", None) is not None:
                    material = {"code": str(result.names[int(result.probs.top1)]), "confidence": round(float(result.probs.top1conf), 4), "source": "model"}
            elif self.material_zero_shot is not None and load_crop.size > 0:
                verdict = self.material_zero_shot.classify(load_crop)
                if not verdict["notCargo"]:
                    material = {k: verdict[k] for k in ("code", "confidence", "source")}

        return {
            "cameraId": self.camera_id,
            "plateNumber": format_plate(text),
            "ocrConfidence": round(ocr_score, 4),
            "detectorConfidence": round(det_score, 4),
            "vehicleType": vehicle_type,
            "material": material,
            "imageUrl": image_url,
            "quality": "ok",
        }

    def _is_blurry(self, frame: Any, plate_box: Box) -> bool:
        x1, y1, x2, y2 = plate_box
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return False
        gray = self.cv2.cvtColor(crop, self.cv2.COLOR_BGR2GRAY)
        variance = self.cv2.Laplacian(gray, self.cv2.CV_64F).var()
        return bool(variance < self.blur_min_variance)

    def capture_image(self, frame: Any, vehicle_box: Box) -> str | None:
        """Cắt khung hình quanh vùng xe (có đệm) rồi upload lên MinIO làm ảnh bằng chứng."""
        if not self.storage.enabled:
            return None
        height, width = frame.shape[:2]
        x1, y1, x2, y2 = vehicle_box
        pad_x, pad_y = int((x2 - x1) * 0.15), int((y2 - y1) * 0.15)
        crop = frame[max(y1 - pad_y, 0) : min(y2 + pad_y, height), max(x1 - pad_x, 0) : min(x2 + pad_x, width)]
        if crop.size == 0:
            crop = frame
        ok, buffer = self.cv2.imencode(".jpg", crop, [int(self.cv2.IMWRITE_JPEG_QUALITY), 85])
        if not ok:
            return None
        return self.storage.upload_jpeg(self.camera_id, "capture", buffer.tobytes())

    def run(self, source: str) -> None:
        cv2 = self.cv2
        capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        open_timeout_msec = env_float("LPR_CAPTURE_TIMEOUT_MSEC", 8000)
        capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, open_timeout_msec)
        capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, open_timeout_msec)
        if not capture.isOpened():
            raise RuntimeError(f"Không mở được nguồn video/luồng: {source}")
        fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
        size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        # grab() liên tục mỗi khung (rẻ, không decode) để giữ luồng tươi/chịu reconnect; chỉ retrieve()+chạy
        # AI khi polling thấy có tín hiệu cân — đúng ý "không chạy AI liên tục suốt lúc xe chưa lên cân".
        poll_every = max(int(round(fps * self.poll_seconds)), 1)
        frame_index = 0

        try:
            while not STOP_REQUESTED:
                if not capture.grab():
                    break
                if frame_index % poll_every == 0:
                    pending = fetch_pending_capture(self.api_base, self.scale_id)
                    if pending is not None:
                        success, frame = capture.retrieve()
                        if success:
                            shot = self.capture_once(frame, size)
                            print(json.dumps({"passId": pending["passId"], **shot}), flush=True)
                            push_capture_result(self.api_base, str(pending["passId"]), shot)
                frame_index += 1
        finally:
            capture.release()


def fetch_pending_capture(base_url: str, scale_id: str) -> dict[str, Any] | None:
    """GET /gate/capture-requests/pending — trả về {"passId", "deadlineAt"} nếu trạm cân này vừa cân xong, None nếu
    không (NestJS trả body rỗng, không phải literal "null", cho trường hợp null — xem apps/api/src/gate/gate.controller.ts)."""
    url = f"{base_url}/gate/capture-requests/pending?scaleId={urllib.parse.quote(scale_id)}"
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            raw = response.read()
            if not raw:
                return None
            payload = json.loads(raw.decode("utf-8"))
            return payload if isinstance(payload, dict) else None
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
        print(f"fetch_pending_capture failed: {error}", file=sys.stderr)
        return None


def push_capture_result(base_url: str, pass_id: str, shot: dict[str, Any]) -> None:
    """POST /gate/passes/{passId}/capture-result — kết quả nhận diện 1 khung hình cho đợt chụp đang mở."""
    body = json.dumps(shot).encode("utf-8")
    request = urllib.request.Request(f"{base_url}/gate/passes/{pass_id}/capture-result", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            response.read()
    except (urllib.error.URLError, OSError) as error:
        print(f"push_capture_result failed: {error}", file=sys.stderr)


def main() -> None:
    if len(sys.argv) < 2:
        raise ValueError("Usage: pipeline.py <video_path_or_stream_url> [camera_id]")
    source = sys.argv[1]
    camera_id = sys.argv[2] if len(sys.argv) >= 3 else "cam-01"
    scale_id = os.getenv("CAPTURE_SCALE_ID", "SCALE-01")
    Pipeline(camera_id, scale_id).run(source)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, request_stop)
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        sys.exit(1)
