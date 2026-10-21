# LPR model

Đặt model YOLO detector vùng biển số vào thư mục này, ví dụ:

```text
models/license-plate-detector.pt
```

Model phải trả bounding box vùng biển số. Worker sẽ dùng RapidOCR đọc ký tự trong vùng đó.

Model thử nghiệm được chọn: `Koushim/yolov8-license-plate-detection` trên Hugging Face.
Model card công bố một class `license_plate` và giấy phép MIT. Tải file `best.pt` rồi đổi tên thành `license-plate-detector.pt`.

Không commit model binary vào Git. Dùng `LPR_MODEL_PATH` để trỏ tới file model.

