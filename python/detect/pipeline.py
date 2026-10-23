"""Nhận diện biển số thật từ video hoặc luồng camera (RTSP), theo dõi từng xe và đẩy kết quả.

Luồng: YOLO phát hiện biển số → RapidOCR đọc ký tự → gom theo xe (track) → chọn khung hình tốt
nhất để phân loại loại xe (COCO) và loại vật liệu (model huấn luyện riêng, hoặc CLIP zero-shot
tạm thời). Không lưu ảnh/khung — chỉ số liệu. Mỗi lượt xác nhận được in ra stdout dạng JSON một
dòng; nếu đặt GATE_API_URL, lượt đó cũng được đẩy thẳng tới `POST {GATE_API_URL}/gate/detections`
(xem apps/api/src/gate/gate.controller.ts).

`<input>` là đường dẫn file video hoặc URL luồng (rtsp://, http://...) — cv2.VideoCapture nhận cả
hai như nhau, nên script này chạy được cho cả file test lẫn camera sống không cần sửa gì thêm.
"""

from __future__ import annotations

import json
import math
import os
import re
import signal
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
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


def iou(first: Box, second: Box) -> float:
    ix1, iy1 = max(first[0], second[0]), max(first[1], second[1])
    ix2, iy2 = min(first[2], second[2]), min(first[3], second[3])
    inter = max(ix2 - ix1, 0) * max(iy2 - iy1, 0)
    union = (first[2] - first[0]) * (first[3] - first[1]) + (second[2] - second[0]) * (second[3] - second[1]) - inter
    return inter / union if union > 0 else 0.0


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


# --- Track -----------------------------------------------------------------------------------


@dataclass
class Observation:
    seconds: float
    box: Box
    text: str
    ocr: float
    det: float

    @property
    def valid(self) -> bool:
        return bool(PLATE_PATTERN.match(self.text))

    @property
    def score(self) -> float:
        area = max((self.box[2] - self.box[0]) * (self.box[3] - self.box[1]), 1)
        return self.ocr * self.det * math.sqrt(area)


@dataclass
class Track:
    track_id: int
    observations: list[Observation] = field(default_factory=list)
    trail: list[Observation] = field(default_factory=list)
    best_frame: Any = None
    best: Observation | None = None
    emitted: int = 0

    @property
    def last(self) -> Observation:
        return self.trail[-1]

    def valid_observations(self) -> list[Observation]:
        return [o for o in self.observations if o.valid]

    def vote(self) -> str:
        weights: dict[str, float] = defaultdict(float)
        for obs in self.valid_observations():
            weights[obs.text] += obs.ocr * obs.det
        return max(weights, key=weights.get) if weights else ""  # type: ignore[arg-type]

    def confirmed(self, min_ocr: float, min_detector: float) -> bool:
        valid = self.valid_observations()
        text = self.vote()
        agreeing = [o for o in valid if o.text == text]
        return len(agreeing) >= 2 or any(o.ocr >= max(min_ocr, 0.9) and o.det >= min_detector for o in agreeing)

    def add(self, obs: Observation, frame: Any) -> None:
        self.trail.append(obs)
        if obs.valid:
            self.observations.append(obs)
            if self.best is None or obs.score > self.best.score:
                self.best, self.best_frame = obs, frame.copy()


class Pipeline:
    def __init__(self, camera_id: str) -> None:
        import cv2
        from ultralytics import YOLO

        try:
            from rapidocr import RapidOCR
        except ImportError:
            from rapidocr_onnxruntime import RapidOCR

        self.cv2 = cv2
        self.camera_id = camera_id

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
        self.timeout = env_float("LPR_TRACK_TIMEOUT", 1.5)
        self.load_fraction = env_float("LOAD_REGION_TOP_FRACTION", 0.5)
        self.active: list[Track] = []
        self.next_id = 1

    # Gán quan sát cho track đang hoạt động theo vị trí; xe vào lại cùng biển trong vài giây thì nối vào track cũ.
    def assign(self, obs: Observation) -> Track | None:
        best: tuple[float, Track] | None = None
        for track in self.active:
            if obs.seconds - track.last.seconds > self.timeout:
                continue
            overlap = iou(track.last.box, obs.box)
            width = max(obs.box[2] - obs.box[0], 1)
            cx, cy = (obs.box[0] + obs.box[2]) / 2, (obs.box[1] + obs.box[3]) / 2
            lx, ly = (track.last.box[0] + track.last.box[2]) / 2, (track.last.box[1] + track.last.box[3]) / 2
            distance = math.hypot(cx - lx, cy - ly) / width
            closeness = overlap if overlap > 0.05 else (1.0 - distance / 2.5 if distance < 2.5 else 0.0)
            if closeness > 0 and (best is None or closeness > best[0]):
                best = (closeness, track)
        if best is not None:
            return best[1]
        if obs.valid:
            for track in self.active:
                if track.vote() == obs.text and obs.seconds - track.last.seconds <= 6.0:
                    return track
        return None

    def build_detection(self, track: Track, size: tuple[int, int], final: bool) -> dict[str, Any] | None:
        best, frame = track.best, track.best_frame
        text = track.vote()
        if best is None or frame is None or not text:
            return None
        # Khung hình tốt nhất theo đúng biển số đã bình chọn.
        agreeing = [o for o in track.valid_observations() if o.text == text]
        best = max(agreeing, key=lambda o: o.score)
        plate_box = best.box

        vehicle = detect_vehicle(self.vehicle_detector, frame, plate_box)
        if vehicle is not None:
            vehicle_box, vehicle_code, vehicle_conf = vehicle
            vehicle_type = {"code": vehicle_code, "confidence": round(vehicle_conf, 4), "source": "model"}
        else:
            vehicle_box = estimate_vehicle_box(plate_box, size)
            vehicle_type = {"code": None, "confidence": None, "source": "unavailable"}

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

        track.emitted = track.emitted + 1
        return {
            "cameraId": self.camera_id,
            "trackId": f"t{track.track_id}",
            "plateNumber": format_plate(text),
            "ocrConfidence": round(best.ocr, 4),
            "detectorConfidence": round(best.det, 4),
            "vehicleType": vehicle_type,
            "material": material,
            "final": final,
        }

    def emit(self, detection: dict[str, Any]) -> None:
        print(json.dumps(detection), flush=True)
        push_detection(detection)

    def finalize(self, track: Track, size: tuple[int, int]) -> None:
        if track in self.active:
            self.active.remove(track)
        if not track.confirmed(self.min_ocr, self.min_detector):
            return
        detection = self.build_detection(track, size, final=True)
        if detection is not None:
            self.emit(detection)

    def run(self, source: str) -> None:
        cv2 = self.cv2
        capture = cv2.VideoCapture(source)
        if not capture.isOpened():
            raise RuntimeError(f"Không mở được nguồn video/luồng: {source}")
        fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
        size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        step = max(int(round(fps * env_float("LPR_SAMPLE_SECONDS", 0.5))), 1)
        frame_index = 0

        try:
            while not STOP_REQUESTED:
                if not capture.grab():
                    break
                if frame_index % step == 0:
                    success, frame = capture.retrieve()
                    if success:
                        self.process_frame(frame, frame_index, fps, size)
                frame_index += 1
        finally:
            capture.release()
        for track in list(self.active):
            self.finalize(track, size)

    def process_frame(self, frame: Any, frame_index: int, fps: float, size: tuple[int, int]) -> None:
        seconds = frame_index / max(fps, 1.0)
        for track in list(self.active):
            if seconds - track.last.seconds > self.timeout:
                self.finalize(track, size)

        result = self.plate_detector(frame, conf=self.confidence, imgsz=self.imgsz, verbose=False)[0]
        if result.boxes is None:
            return
        for coordinates, det in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.conf.cpu().tolist()):
            box = clamp_box(tuple(coordinates), size)  # type: ignore[arg-type]
            if box[2] - box[0] < 12 or box[3] - box[1] < 6:
                continue
            text, ocr = ocr_plate(self.cv2, self.ocr, frame, box)
            obs = Observation(seconds, box, text if ocr >= self.min_ocr else "", ocr, float(det))
            track = self.assign(obs)
            if track is None:
                if not obs.valid:
                    continue
                track = Track(self.next_id)
                self.next_id += 1
                self.active.append(track)
            track.add(obs, frame)
            if track.emitted == 0 and track.confirmed(self.min_ocr, self.min_detector):
                detection = self.build_detection(track, size, final=False)
                if detection is not None:
                    self.emit(detection)


def push_detection(detection: dict[str, Any]) -> None:
    """Đẩy một lượt nhận diện tới NestJS API; bỏ qua nếu chưa cấu hình GATE_API_URL (chỉ in ra stdout)."""
    base_url = os.getenv("GATE_API_URL", "").strip().rstrip("/")
    if base_url == "":
        return
    body = json.dumps(detection).encode("utf-8")
    request = urllib.request.Request(f"{base_url}/gate/detections", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            response.read()
    except (urllib.error.URLError, OSError) as error:
        print(f"push_detection failed: {error}", file=sys.stderr)


def main() -> None:
    if len(sys.argv) < 2:
        raise ValueError("Usage: pipeline.py <video_path_or_stream_url> [camera_id]")
    source = sys.argv[1]
    camera_id = sys.argv[2] if len(sys.argv) >= 3 else "cam-01"
    Pipeline(camera_id).run(source)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, request_stop)
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        sys.exit(1)
