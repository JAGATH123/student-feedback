"""
FER inference — uses hsemotion-onnx (enet_b2_8_best, trained on AffectNet 1.7M images).

Replaces the old FER2013-trained custom CNN. AffectNet is real-world data which
generalises far better to webcam/kiosk conditions than FER2013.

Face detection: OpenCV DNN SSD (res10_300x300) — kept from previous version.
Emotion model:  EfficientNet-B2 via ONNX runtime, 8 classes:
                Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise
"""

import os
import urllib.request  # force-loads submodule; fixes hsemotion-onnx on Python 3.13
import cv2
import numpy as np

_BASE       = os.path.dirname(__file__)
_PROTO_PATH = os.path.join(_BASE, "face_detector", "deploy.prototxt")
_CAFFE_PATH = os.path.join(_BASE, "face_detector", "res10_300x300_ssd_iter_140000.caffemodel")

# hsemotion label → our lowercase key
_LABEL_MAP = {
    "Anger":     "angry",
    "Contempt":  "contempt",
    "Disgust":   "disgust",
    "Fear":      "fear",
    "Happiness": "happy",
    "Neutral":   "neutral",
    "Sadness":   "sad",
    "Surprise":  "surprise",
}

_fer:      object | None = None
_face_net: cv2.dnn.Net | None = None


_MODEL_NAME  = "enet_b2_8"
_MODEL_CACHE = os.path.join(os.path.expanduser("~"), ".hsemotion", f"{_MODEL_NAME}.onnx")


def load_model() -> None:
    """Pre-load both models at startup to avoid cold-start on first request."""
    global _fer, _face_net
    if _fer is None:
        from hsemotion_onnx.facial_emotions import HSEmotionRecognizer
        _fer = HSEmotionRecognizer(model_name=_MODEL_NAME)
    if _face_net is None:
        _face_net = cv2.dnn.readNetFromCaffe(_PROTO_PATH, _CAFFE_PATH)


def _get_face_net() -> cv2.dnn.Net:
    global _face_net
    if _face_net is None:
        _face_net = cv2.dnn.readNetFromCaffe(_PROTO_PATH, _CAFFE_PATH)
    return _face_net


def _detect_faces(img_bgr: np.ndarray, conf_thresh: float = 0.5):
    """Returns list of (x1,y1,x2,y2,confidence,area) sorted largest-first."""
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
        area = (x2 - x1) * (y2 - y1)
        results.append((x1, y1, x2, y2, conf, area))

    results.sort(key=lambda r: -r[5])
    return results


def predict_emotion(image_path: str) -> dict:
    """
    Detect the largest face, run hsemotion-onnx inference.

    Returns:
        dominant_emotion : str | None  — None means no face detected
        emotions         : dict[str, float]  — 0–100 scale, 8 keys
        face_confidence  : float             — SSD detection score (0–1)

    Raises:
        ValueError if the image file cannot be read.
    """
    global _fer
    if _fer is None:
        from hsemotion_onnx.facial_emotions import HSEmotionRecognizer
        _fer = HSEmotionRecognizer(model_name=_MODEL_NAME)

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError("Could not read image file")

    h, w = img_bgr.shape[:2]
    faces = _detect_faces(img_bgr, conf_thresh=0.5)

    if not faces:
        return {
            "dominant_emotion": None,
            "emotions":         {v: 0.0 for v in _LABEL_MAP.values()},
            "face_confidence":  0.0,
        }

    x1, y1, x2, y2, face_conf, _ = faces[0]

    # 15% padding so forehead and chin are included
    pad = int(0.15 * max(x2 - x1, y2 - y1))
    rx1 = max(0, x1 - pad)
    ry1 = max(0, y1 - pad)
    rx2 = min(w, x2 + pad)
    ry2 = min(h, y2 + pad)
    face_crop = img_bgr[ry1:ry2, rx1:rx2]

    # hsemotion expects BGR numpy array of the face region
    emotion_label, scores = _fer.predict_emotions(face_crop, logits=False)

    # scores is a numpy array aligned to the model's internal label order
    # Use the returned label string as dominant
    dominant = _LABEL_MAP.get(emotion_label, emotion_label.lower())

    # Build full emotions dict — map each label to its score (0–100 scale)
    model_labels = list(_fer.idx_to_class.values()) if hasattr(_fer, "idx_to_class") else list(_LABEL_MAP.keys())
    emotions: dict[str, float] = {}
    for i, lbl in enumerate(model_labels):
        key = _LABEL_MAP.get(lbl, lbl.lower())
        emotions[key] = round(float(scores[i]) * 100, 4)

    # Ensure all 8 keys are present
    for v in _LABEL_MAP.values():
        emotions.setdefault(v, 0.0)

    return {
        "dominant_emotion": dominant,
        "emotions":         emotions,
        "face_confidence":  float(face_conf),
    }
