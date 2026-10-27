"""Upload ảnh bằng chứng (frame xe/biển số lúc nhận diện) lên MinIO.

Tối giản theo đúng tinh thần của GATE_API_URL: không cấu hình MINIO_ENDPOINT thì pipeline vẫn
chạy được như cũ, chỉ bỏ qua bước lưu/upload ảnh (không lỗi, không chặn nhận diện). Bucket được
tạo tự động và set quyền đọc công khai theo object (anonymous download) nếu chưa có — bucket
không cho liệt kê (list), chỉ GET đúng key mới xem được, nên link ảnh dùng thẳng được trên
dashboard mà không cần thêm endpoint presign ở apps/api.
"""

from __future__ import annotations

import io
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any


class ImageUploader:
    def __init__(self) -> None:
        self.enabled = False
        self.client: Any = None
        endpoint = os.getenv("MINIO_ENDPOINT", "").strip()
        if endpoint == "":
            return

        from minio import Minio

        secure = os.getenv("MINIO_SECURE", "false").strip().lower() == "true"
        self.bucket = os.getenv("MINIO_BUCKET", "camera-captures").strip()
        self.public_url = os.getenv("MINIO_PUBLIC_URL", "").strip().rstrip("/") or f"http{'s' if secure else ''}://{endpoint}"
        try:
            client = Minio(
                endpoint,
                access_key=os.getenv("MINIO_ACCESS_KEY", ""),
                secret_key=os.getenv("MINIO_SECRET_KEY", ""),
                secure=secure
            )
            if not client.bucket_exists(self.bucket):
                client.make_bucket(self.bucket)
            client.set_bucket_policy(self.bucket, _anonymous_read_policy(self.bucket))
        except Exception as error:  # noqa: BLE001 — MinIO không sẵn sàng thì bỏ qua lưu ảnh, không chặn nhận diện.
            print(f"MinIO không sẵn sàng ({endpoint}), bỏ qua lưu ảnh: {error}", file=sys.stderr)
            return
        self.client = client
        self.enabled = True

    def upload_jpeg(self, camera_id: str, track_id: str, data: bytes) -> str | None:
        """Upload một ảnh JPEG, trả về link công khai hoặc None nếu chưa cấu hình/upload lỗi."""
        if not self.enabled:
            return None
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d/%H%M%S")
        key = f"{camera_id}/{stamp}-{track_id}-{uuid.uuid4().hex[:8]}.jpg"
        try:
            self.client.put_object(self.bucket, key, io.BytesIO(data), length=len(data), content_type="image/jpeg")
        except Exception as error:  # noqa: BLE001
            print(f"Upload ảnh lên MinIO thất bại: {error}", file=sys.stderr)
            return None
        return f"{self.public_url}/{self.bucket}/{key}"


def _anonymous_read_policy(bucket: str) -> str:
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": [f"arn:aws:s3:::{bucket}/*"]
        }]
    })
