import { ReactElement, RefObject, useEffect, useState } from "react";
import type { GatePass } from "./PassDetail";

interface VideoOverlayProps {
  src: string;
  passes: GatePass[];
  videoRef: RefObject<HTMLVideoElement | null>;
  selectedId?: string | null;
}

interface Box {
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MAX_GAP_SECONDS = 1.2;

/** Nội suy một trail tại thời điểm t; null nếu t ngoài vùng track đó. */
function sampleTrail(trail: [number, number, number, number, number][], time: number): [number, number, number, number] | null {
  if (trail.length === 0 || time < trail[0]![0] - 0.4 || time > trail[trail.length - 1]![0] + 0.4) {
    return null;
  }
  let before = trail[0]!;
  let after = trail[trail.length - 1]!;
  for (const sample of trail) {
    if (sample[0] <= time) {
      before = sample;
    } else {
      after = sample;
      break;
    }
  }
  const span = after[0] - before[0];
  const ratio = span > 0 && span <= MAX_GAP_SECONDS ? Math.min(Math.max((time - before[0]) / span, 0), 1) : 0;
  const lerp = (a: number, b: number): number => a + (b - a) * ratio;
  return [lerp(before[1], after[1]), lerp(before[2], after[2]), lerp(before[3], after[3]), lerp(before[4], after[4])];
}

/**
 * Vị trí biển số của một xe tại thời điểm t. Một lượt xe có hai track rời nhau trong cùng video (lúc vào,
 * lúc ra) nên thử cả hai, không chỉ track lúc vào.
 */
function boxAt(pass: GatePass, time: number): Box | null {
  const entry = sampleTrail(pass.capture.trail, time);
  if (entry !== null) {
    return { id: pass.id, label: pass.capture.plateText, x1: entry[0], y1: entry[1], x2: entry[2], y2: entry[3] };
  }
  if (pass.exitCapture !== null) {
    const exit = sampleTrail(pass.exitCapture.trail, time);
    if (exit !== null) {
      return { id: pass.id, label: pass.exitCapture.plateText, x1: exit[0], y1: exit[1], x2: exit[2], y2: exit[3] };
    }
  }
  return null;
}

/** Video gốc kèm khung khoanh vùng biển số đồng bộ theo thời gian phát. */
export default function VideoOverlay({ src, passes, videoRef, selectedId }: VideoOverlayProps): ReactElement {
  const [time, setTime] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return undefined;
    }
    let frame = 0;
    const tick = (): void => {
      setTime(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    const start = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      cancelAnimationFrame(frame);
      setTime(video.currentTime);
    };
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("loadedmetadata", () => video.videoWidth > 0 && setAspect(video.videoWidth / video.videoHeight));
    if (!video.paused) {
      start();
    }
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", stop);
      video.removeEventListener("ended", stop);
    };
  }, [videoRef, src]);

  const boxes = passes.map((pass) => boxAt(pass, time)).filter((box): box is Box => box !== null);

  return (
    <div className="video-overlay" style={{ aspectRatio: aspect }}>
      <video controls ref={videoRef} src={src} />
      <svg aria-label="Khung biển số" preserveAspectRatio="none" viewBox="0 0 1 1">
        {boxes.map((box) => (
          <rect
            className={box.id === selectedId ? "plate-box selected" : "plate-box"}
            height={box.y2 - box.y1}
            key={box.id}
            vectorEffect="non-scaling-stroke"
            width={box.x2 - box.x1}
            x={box.x1}
            y={box.y1}
          />
        ))}
      </svg>
      <div className="plate-labels">
        {boxes.map((box) => (
          <span key={box.id} style={{ left: `${box.x1 * 100}%`, top: `${box.y1 * 100}%` }}>{box.label}</span>
        ))}
      </div>
    </div>
  );
}
