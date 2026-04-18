"""
FER inference — custom CNN trained on FER2013 (fer.h5), with ALL-face detection.

Architecture reproduced exactly from webcam_test.py (the original training script):
  Block 1: Conv2D(32, 3x3, valid) → BN → ReLU → Dropout(0.25)
  Block 2: Conv2D(64, 3x3, same)  → BN → ReLU → MaxPool(2x2)
  Block 3: Conv2D(64, 3x3, valid) → BN → ReLU → Dropout(0.25)
  Block 4: Conv2D(128,3x3, same)  → BN → ReLU → MaxPool(2x2)
  Block 5: Conv2D(128,3x3, valid) → BN → ReLU → MaxPool(2x2)
  Flatten → Dense(250, relu) → Dropout(0.5) → Dense(7, softmax)

Input:   48×48 grayscale
Classes: angry(0), disgust(1), fear(2), happy(3), sad(4), surprise(5), neutral(6)
Preprocessing: equalizeHist + /255.0

Face detection: OpenCV DNN SSD (res10_300x300) — detects ALL faces in the frame.
Aggregation:    emotion scores are averaged across all detected faces.
"""

import os
import cv2
import numpy as np

_BASE       = os.path.dirname(__file__)
_PROTO_PATH = os.path.join(_BASE, "face_detector", "deploy.prototxt")
_CAFFE_PATH = os.path.join(_BASE, "face_detector", "res10_300x300_ssd_iter_140000.caffemodel")
_MODEL_PATH = os.path.join(_BASE, "fer.h5")

# FER2013 label order — index matches model softmax output
_LABELS = ("angry", "disgust", "fear", "happy", "sad", "surprise", "neutral")

# ── Workshop-mode score bias ───────────────────────────────────────────────────
# Applied BEFORE picking the dominant emotion label.
# Target: happy wins even at 10 % raw vs 70 % neutral raw.
#   10 × 6.5 = 65  >  70 × 0.6 = 42  → happy wins ✓
# Raw scores are stored unchanged; only dominant label is affected.
_WORKSHOP_BOOST: dict[str, float] = {
    "happy":   6.5,   # even a faint smile (10%) beats a strong neutral (70%)
    "surprise": 3.0,  # curiosity/engagement → strongly positive
    "neutral":  0.6,  # heavily suppressed — rarely wins now
    "sad":     0.22,  # almost never wins
    "fear":    0.18,
    "disgust": 0.18,
    "angry":   0.18,
}

_model:    object         | None = None
_face_net: "cv2.dnn.Net" | None = None


# ── Model construction ────────────────────────────────────────────────────────

def _build_model():
    """Rebuild the exact architecture from webcam_test.py, then load weights."""
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import (
        Conv2D, BatchNormalization, Activation,
        Dropout, MaxPooling2D, Flatten, Dense,
    )
    m = Sequential([
        # Block 1
        Conv2D(32, (3, 3), padding="valid", input_shape=(48, 48, 1)),
        BatchNormalization(), Activation("relu"), Dropout(0.25),
        # Block 2
        Conv2D(64, (3, 3), padding="same"),
        BatchNormalization(), Activation("relu"), MaxPooling2D((2, 2)),
        # Block 3
        Conv2D(64, (3, 3), padding="valid"),
        BatchNormalization(), Activation("relu"), Dropout(0.25),
        # Block 4
        Conv2D(128, (3, 3), padding="same"),
        BatchNormalization(), Activation("relu"), MaxPooling2D((2, 2)),
        # Block 5
        Conv2D(128, (3, 3), padding="valid"),
        BatchNormalization(), Activation("relu"), MaxPooling2D((2, 2)),
        # Fully connected
        Flatten(),
        Dense(250, activation="relu"),
        Dropout(0.5),
        Dense(7, activation="softmax"),
    ])
    m.load_weights(_MODEL_PATH)
    return m


# ── Face detection (OpenCV DNN SSD) ──────────────────────────────────────────

def _get_face_net() -> "cv2.dnn.Net":
    global _face_net
    if _face_net is None:
        _face_net = cv2.dnn.readNetFromCaffe(_PROTO_PATH, _CAFFE_PATH)
    return _face_net


def _detect_faces(img_bgr: np.ndarray, conf_thresh: float = 0.5) -> list:
    """
    Returns list of (x1, y1, x2, y2, confidence, area) for EVERY face
    whose SSD confidence >= conf_thresh, sorted largest-first.
    """
    net = _get_face_net()
    h, w = img_bgr.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(img_bgr, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0)
    )
    net.setInput(blob)
    dets = net.forward()

    results = []
    for i in range(dets.shape[2]):
        conf = float(dets[0, 0, i, 2])
        if conf < conf_thresh:
            continue
        x1 = int(dets[0, 0, i, 3] * w)
        y1 = int(dets[0, 0, i, 4] * h)
        x2 = int(dets[0, 0, i, 5] * w)
        y2 = int(dets[0, 0, i, 6] * h)
        if x2 <= x1 or y2 <= y1:
            continue
        area = (x2 - x1) * (y2 - y1)
        results.append((x1, y1, x2, y2, conf, area))

    results.sort(key=lambda r: -r[5])   # largest face first
    return results


def _run_fer(gray: np.ndarray, x1: int, y1: int, x2: int, y2: int,
             img_h: int, img_w: int) -> np.ndarray:
    """Crop, pad, preprocess one face region and return softmax scores (7,)."""
    pad  = int(0.15 * max(x2 - x1, y2 - y1))
    rx1  = max(0, x1 - pad);  ry1 = max(0, y1 - pad)
    rx2  = min(img_w, x2 + pad);  ry2 = min(img_h, y2 + pad)

    roi  = gray[ry1:ry2, rx1:rx2]
    roi  = cv2.resize(roi, (48, 48))
    roi  = cv2.equalizeHist(roi)

    arr  = roi.astype("float32")
    arr  = np.expand_dims(arr, axis=-1)   # (48, 48, 1)
    arr  = np.expand_dims(arr, axis=0)    # (1, 48, 48, 1)
    arr /= 255.0

    return _model.predict(arr, verbose=0)[0]   # (7,)


# ── Public API ────────────────────────────────────────────────────────────────

def load_model() -> None:
    """Pre-load both models at startup to avoid cold-start on first request."""
    global _model, _face_net
    if _model is None:
        _model = _build_model()
    if _face_net is None:
        _face_net = cv2.dnn.readNetFromCaffe(_PROTO_PATH, _CAFFE_PATH)


def predict_emotion(image_path: str) -> dict:
    """
    Detect ALL faces in the image and run fer.h5 on each one.
    Emotion scores are averaged across every detected face.

    Returns:
        face_count       : int              — number of faces found (0 if none)
        dominant_emotion : str | None       — None when no face detected
        emotions         : dict[str, float] — averaged scores, 0–100 scale, 7 keys
        face_confidence  : float            — mean SSD detection confidence (0–1)

    Raises:
        ValueError if the image file cannot be read.
    """
    global _model
    if _model is None:
        _model = _build_model()

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError("Could not read image file")

    h, w   = img_bgr.shape[:2]
    faces  = _detect_faces(img_bgr, conf_thresh=0.5)

    if not faces:
        return {
            "face_count":       0,
            "dominant_emotion": None,
            "emotions":         {lbl: 0.0 for lbl in _LABELS},
            "face_confidence":  0.0,
        }

    gray       = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    all_scores = []   # each entry is a (7,) numpy array
    all_confs  = []

    for x1, y1, x2, y2, face_conf, _ in faces:
        preds = _run_fer(gray, x1, y1, x2, y2, h, w)
        all_scores.append(preds)
        all_confs.append(face_conf)

    # Average emotion scores across all detected faces
    agg = np.mean(all_scores, axis=0)          # (7,)  raw averaged probabilities

    # Apply workshop bias to choose dominant — raw scores stored unchanged
    boost   = np.array([_WORKSHOP_BOOST[lbl] for lbl in _LABELS])
    biased  = agg * boost
    dominant = _LABELS[int(np.argmax(biased))]

    # Store honest raw scores (0–100 scale) for analytics
    emotions = {
        lbl: round(float(agg[i]) * 100, 4)
        for i, lbl in enumerate(_LABELS)
    }

    return {
        "face_count":       len(faces),
        "dominant_emotion": dominant,
        "emotions":         emotions,
        "face_confidence":  float(np.mean(all_confs)),
    }
