# python/train/ — huấn luyện model (chưa triển khai)

Thư mục dành cho script/notebook huấn luyện lại model nhận diện khi có đủ dữ liệu thật của mỏ:

- Model phân loại vật liệu riêng (thay cho CLIP zero-shot tạm thời trong `python/detect/pipeline.py`)
  — tên class `sand`, `stone_2_3`, `stone_4_6`, `boulder`, `empty` theo đúng mã trong `apps/api/src/gate/gate.catalog.ts`.
- Fine-tune lại model biển số/xe nếu dữ liệu hiện trường khác nhiều so với bộ gốc.

Chưa có script nào ở đây. Khi thêm, trỏ `MATERIAL_MODEL_PATH` (hoặc biến tương ứng) sang file
`.pt` xuất ra, đặt trong `python/models/`.
