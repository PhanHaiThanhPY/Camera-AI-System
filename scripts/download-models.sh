#!/usr/bin/env bash
# Tải model cần cho worker vào thư mục models/ (file .pt không commit vào Git).
set -euo pipefail
cd "$(dirname "$0")/../models"

# Phát hiện biển số (YOLOv8, giấy phép MIT): Koushim/yolov8-license-plate-detection
curl -fL -o license-plate-detector.pt \
  https://huggingface.co/Koushim/yolov8-license-plate-detection/resolve/main/best.pt

# Phát hiện xe COCO (car/motorcycle/bus/truck) để cắt ảnh xe và ảnh đá
curl -fL -o yolov8n.pt \
  https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt

ls -la *.pt
