FROM python:3.10-slim

WORKDIR /app

# System deps for OpenCV / DeepFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download DeepFace model weights at build time so the first request is instant
RUN python - <<'EOF'
import urllib.request, os, pathlib
weights_dir = pathlib.Path.home() / ".deepface" / "weights"
weights_dir.mkdir(parents=True, exist_ok=True)
# Trigger model download via a tiny synthetic image
import numpy as np, cv2, tempfile
img = np.ones((100,100,3), dtype=np.uint8) * 200
with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
    cv2.imwrite(f.name, img)
    try:
        from deepface import DeepFace
        DeepFace.analyze(f.name, actions=["emotion"], enforce_detection=False, silent=True)
    except Exception:
        pass  # Face won't be detected — model is still downloaded
    os.remove(f.name)
EOF

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
