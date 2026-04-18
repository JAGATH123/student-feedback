FROM python:3.10-slim

WORKDIR /app

# System libs required by OpenCV headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (cached layer — only rebuilds when requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy model files and app code
COPY . .

# Warm up tensorflow + fer.h5 at build time so the first real request is instant.
# Uses a blank 100x100 image — no real face needed, just exercises the model load path.
RUN python - <<'EOF'
import numpy as np, cv2, tempfile, os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
img = np.ones((100, 100, 3), dtype=np.uint8) * 128
with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
    cv2.imwrite(f.name, img)
    try:
        import fer_model
        fer_model.load_model()
        fer_model.predict_emotion(f.name)
    except Exception as e:
        print(f"Warmup note: {e}")
    finally:
        os.remove(f.name)
EOF

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
