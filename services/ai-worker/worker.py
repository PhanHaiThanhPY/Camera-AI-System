"""Video worker for the first Camera AI MVP.

The default mode is deliberately deterministic so the full upload flow can be
demoed before a production LPR model and labeled camera footage are available.
Set AI_DEMO_MODE=false after wiring a real detector into this worker.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, capture_output=True, text=True)


def probe_video(input_path: Path) -> dict[str, int | float | None]:
    try:
        result = run_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,duration",
                "-of",
                "json",
                str(input_path),
            ]
        )
        payload: Any = json.loads(result.stdout)
        stream = payload.get("streams", [{}])[0]
        return {
            "durationSeconds": float(stream["duration"]) if stream.get("duration") else None,
            "width": int(stream["width"]) if stream.get("width") else None,
            "height": int(stream["height"]) if stream.get("height") else None,
        }
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, IndexError):
        return {"durationSeconds": None, "width": None, "height": None}


def create_evidence(input_path: Path, output_dir: Path, job_id: str) -> tuple[Path, Path]:
    job_output_dir = output_dir / job_id
    job_output_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = job_output_dir / f"{job_id}-snapshot.jpg"
    annotated_path = job_output_dir / f"{job_id}-annotated.mp4"

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is not None:
        try:
            run_command(
                [
                    ffmpeg,
                    "-y",
                    "-ss",
                    "0.5",
                    "-i",
                    str(input_path),
                    "-frames:v",
                    "1",
                    str(snapshot_path),
                ]
            )
        except (OSError, subprocess.CalledProcessError):
            shutil.copyfile(input_path, snapshot_path)
    else:
        shutil.copyfile(input_path, snapshot_path)

    # Demo mode does not need a second full video encode. Copying preserves the
    # original quality and makes the result available almost immediately.
    shutil.copyfile(input_path, annotated_path)

    return snapshot_path, annotated_path


def normalize_plate(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def format_plate(value: str) -> str:
    if re.fullmatch(r"\d{2}[A-Z]\d{5}", value):
        return f"{value[:3]} {value[3:6]}.{value[6:]}"
    return value


def find_related_plate(
    aggregate: dict[str, dict[str, object]],
    plate: str,
    event_seconds: float,
) -> str | None:
    for aggregate_key, detection in aggregate.items():
        existing_plate = normalize_plate(str(detection.get("plateNumber", aggregate_key)))
        last_seconds = float(detection.get("lastDetectedSeconds", event_seconds))
        if event_seconds - last_seconds > 4.0:
            continue
        if existing_plate == plate or existing_plate.endswith(plate) or plate.endswith(existing_plate):
            return aggregate_key
    return None


def timestamp_for_frame(frame_index: int, fps: float) -> str:
    total_seconds = int(frame_index / max(fps, 1.0))
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes:02d}:{seconds:02d}"


def load_lpr_dependencies() -> tuple[Any, Any, Any]:
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "Thiếu dependency LPR. Hãy cài services/ai-worker/requirements.txt "
            "hoặc bật AI_DEMO_MODE=true."
        ) from error

    model_path = os.getenv("LPR_MODEL_PATH", "")
    if not model_path:
        raise RuntimeError("LPR_MODEL_PATH chưa được cấu hình cho AI_DEMO_MODE=false.")

    configured_model_path = Path(model_path).expanduser()
    model_candidates = [configured_model_path]
    if not configured_model_path.is_absolute():
        model_candidates.append(Path(__file__).resolve().parents[2] / configured_model_path)
    resolved_model_path = next(
        (candidate.resolve() for candidate in model_candidates if candidate.exists()),
        configured_model_path.resolve(),
    )
    if not resolved_model_path.exists():
        raise RuntimeError(f"Không tìm thấy LPR model tại: {resolved_model_path}")

    try:
        from rapidocr import RapidOCR
    except ImportError:
        from rapidocr_onnxruntime import RapidOCR

    return cv2, YOLO(str(resolved_model_path)), RapidOCR()


def read_ocr_text(ocr_engine: Any, crop: Any) -> tuple[str, float]:
    candidates: list[tuple[float, float, str, float]] = []
    ocr_result = ocr_engine(crop)

    if isinstance(ocr_result, tuple):
        legacy_items = ocr_result[0] or []
        for item in legacy_items:
            if len(item) < 3:
                continue
            text = normalize_plate(str(item[1]))
            try:
                confidence = float(item[2])
            except (TypeError, ValueError):
                confidence = 0.0
            box = item[0] if item else []
            x = min((float(point[0]) for point in box), default=0.0)
            y = min((float(point[1]) for point in box), default=0.0)
            if text:
                candidates.append((y, x, text, confidence))
    else:
        raw_boxes = getattr(ocr_result, "boxes", None)
        boxes = list(raw_boxes) if raw_boxes is not None else []
        texts = list(getattr(ocr_result, "txts", []) or [])
        scores = list(getattr(ocr_result, "scores", []) or [])
        for index, (text_value, score_value) in enumerate(zip(texts, scores)):
            text = normalize_plate(str(text_value))
            try:
                confidence = float(score_value)
            except (TypeError, ValueError):
                confidence = 0.0
            box = boxes[index] if index < len(boxes) else []
            x = min((float(point[0]) for point in box), default=float(index))
            y = min((float(point[1]) for point in box), default=0.0)
            if text:
                candidates.append((y, x, text, confidence))

    if not candidates:
        return "", 0.0

    candidates.sort(key=lambda candidate: (candidate[0], candidate[1]))
    combined_text = normalize_plate("".join(candidate[2] for candidate in candidates))
    combined_confidence = sum(candidate[3] for candidate in candidates) / len(candidates)
    if len(combined_text) >= 4:
        return combined_text, round(combined_confidence, 4)
    best_candidate = max(candidates, key=lambda candidate: candidate[3])
    return best_candidate[2], best_candidate[3]


def model_evidence(
    input_path: Path,
    output_dir: Path,
    job_id: str,
) -> tuple[Path, list[dict[str, object]]]:
    cv2, detector, ocr_engine = load_lpr_dependencies()
    job_output_dir = output_dir / job_id
    job_output_dir.mkdir(parents=True, exist_ok=True)
    annotated_path = job_output_dir / f"{job_id}-annotated.mp4"
    raw_annotated_path = job_output_dir / f"{job_id}-annotated-raw.mp4"
    aggregate: dict[str, dict[str, object]] = {}

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Không thể mở video: {input_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_seconds = max(float(os.getenv("LPR_SAMPLE_SECONDS", "1.0")), 0.1)
    sample_interval = max(int(round(fps * sample_seconds)), 1)
    confidence_threshold = float(os.getenv("LPR_CONFIDENCE", "0.35"))
    render_annotated = os.getenv("LPR_RENDER_ANNOTATED_VIDEO", "false").lower() == "true"
    writer = cv2.VideoWriter(
        str(raw_annotated_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    ) if render_annotated else None
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    progress_interval = max(int(total_frames * 0.05), 1)
    active_boxes: list[tuple[int, int, int, int, str, float]] = []
    frame_index = 0

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break

            if frame_index % sample_interval == 0:
                active_boxes = []
                predictions = detector(frame, conf=confidence_threshold, verbose=False)
                for prediction in predictions:
                    if prediction.boxes is None:
                        continue

                    boxes = prediction.boxes.xyxy.cpu().tolist()
                    scores = prediction.boxes.conf.cpu().tolist()
                    timestamp = timestamp_for_frame(frame_index, fps)
                    for coordinates, detector_score in zip(boxes, scores):
                        x1, y1, x2, y2 = [max(int(value), 0) for value in coordinates]
                        x2 = min(x2, width)
                        y2 = min(y2, height)
                        crop = frame[y1:y2, x1:x2]
                        if crop.size == 0:
                            continue

                        plate, ocr_score = read_ocr_text(ocr_engine, crop)
                        if not plate:
                            continue

                        score = round(float(detector_score) * max(ocr_score, 0.01), 4)
                        event_seconds = round(frame_index / max(fps, 1.0), 2)
                        aggregate_key = find_related_plate(aggregate, plate, event_seconds) or plate
                        display_plate = format_plate(plate)
                        active_boxes.append((x1, y1, x2, y2, display_plate, score))
                        current_confidence = float(aggregate.get(aggregate_key, {}).get("confidence", 0.0))
                        is_best_evidence = aggregate_key not in aggregate or score > current_confidence
                        if aggregate_key not in aggregate:
                            aggregate[aggregate_key] = {
                                "plateNumber": display_plate,
                                "confidence": score,
                                "firstDetectedAt": timestamp,
                                "lastDetectedAt": timestamp,
                                "lastDetectedSeconds": event_seconds,
                                "evidenceSeconds": event_seconds,
                                "evidenceMode": "model",
                            }
                        else:
                            aggregate[aggregate_key]["lastDetectedAt"] = timestamp
                            aggregate[aggregate_key]["lastDetectedSeconds"] = event_seconds
                            aggregate[aggregate_key]["confidence"] = max(
                                float(aggregate[aggregate_key]["confidence"]), score
                            )
                            if len(plate) > len(normalize_plate(str(aggregate[aggregate_key]["plateNumber"]))):
                                aggregate[aggregate_key]["plateNumber"] = display_plate

                        if is_best_evidence:
                            snapshot_path = job_output_dir / f"plate-{aggregate_key}.jpg"
                            overview_path = job_output_dir / f"event-{aggregate_key}.jpg"
                            evidence_frame = frame.copy()
                            cv2.rectangle(evidence_frame, (x1, y1), (x2, y2), (0, 255, 0), 3)
                            cv2.putText(
                                evidence_frame,
                                f"{plate} {score:.2f}",
                                (x1, max(y1 - 12, 24)),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.9,
                                (0, 255, 0),
                                2,
                            )
                            cv2.imwrite(str(snapshot_path), crop)
                            cv2.imwrite(str(overview_path), evidence_frame)
                            aggregate[aggregate_key]["evidenceSeconds"] = event_seconds
                            aggregate[aggregate_key]["evidenceSnapshotUrl"] = (
                                f"/storage/results/{job_id}/{overview_path.name}"
                            )

            if render_annotated and writer is not None:
                for x1, y1, x2, y2, plate, score in active_boxes:
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(
                        frame,
                        f"{plate} {score:.2f}",
                        (x1, max(y1 - 8, 20)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        (0, 255, 0),
                        2,
                    )
                writer.write(frame)
            if frame_index % progress_interval == 0 and total_frames > 0:
                progress = int((frame_index / total_frames) * 100)
                print(f"WORKER_PROGRESS={progress}", file=sys.stderr, flush=True)
            frame_index += 1
    finally:
        capture.release()
        if writer is not None:
            writer.release()

    ffmpeg = shutil.which("ffmpeg")
    if not render_annotated:
        shutil.copyfile(input_path, annotated_path)
    elif ffmpeg is not None:
        try:
            run_command(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(raw_annotated_path),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "28",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    "-an",
                    str(annotated_path),
                ]
            )
            raw_annotated_path.unlink(missing_ok=True)
        except (OSError, subprocess.CalledProcessError):
            raw_annotated_path.replace(annotated_path)
    else:
        raw_annotated_path.replace(annotated_path)

    detections: list[dict[str, object]] = []
    for plate, detection in aggregate.items():
        snapshot_path = job_output_dir / f"plate-{plate}.jpg"
        detections.append(
            {
                **detection,
                "snapshotUrl": f"/storage/results/{job_id}/{snapshot_path.name}",
            }
        )

    return annotated_path, detections


def main() -> None:
    if len(sys.argv) != 4:
        raise ValueError("Usage: worker.py <input_path> <result_root> <job_id>")

    input_path = Path(sys.argv[1]).resolve()
    result_root = Path(sys.argv[2]).resolve()
    job_id = sys.argv[3]
    metadata = probe_video(input_path)
    demo_mode = os.getenv("AI_DEMO_MODE", "true").lower() != "false"

    if demo_mode:
        snapshot_path, annotated_path = create_evidence(input_path, result_root, job_id)
        detections: list[dict[str, object]] = [
            {
                "plateNumber": os.getenv("DEMO_PLATE_NUMBER", "DEMO-PLATE"),
                "confidence": 0.91,
                "firstDetectedAt": "00:00",
                "lastDetectedAt": "00:05",
                "evidenceSeconds": 0,
                "snapshotUrl": f"/storage/results/{job_id}/{snapshot_path.name}",
                "evidenceSnapshotUrl": f"/storage/results/{job_id}/{snapshot_path.name}",
                "evidenceMode": "demo",
            }
        ]
    else:
        annotated_path, detections = model_evidence(input_path, result_root, job_id)

    print(
        json.dumps(
            {
                **metadata,
                "annotatedVideoPath": str(annotated_path),
                "detections": detections,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        sys.exit(1)

