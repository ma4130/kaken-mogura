import { applyHomography, computeHomography } from './homography.js';

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const STORAGE_KEY = 'mogura-camera-calibration-v1';
const CORNER_LABELS = ['左上', '右上', '右下', '左下'];

const visible = (point) => point && (point.visibility ?? 1) >= 0.42;

export class CameraFootTracker {
  constructor({ video, canvas, onFeet, onStatus }) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.onFeet = onFeet;
    this.onStatus = onStatus;
    this.stream = null;
    this.detector = null;
    this.animationFrame = 0;
    this.generation = 0;
    this.lastVideoTime = -1;
    this.lastInferenceAt = 0;
    this.calibrationPoints = [];
    this.homography = null;
    this.loadCalibration();
  }

  get isRunning() {
    return Boolean(this.stream && this.detector);
  }

  get calibrationCount() {
    return this.calibrationPoints.length;
  }

  loadCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (!Array.isArray(saved) || saved.length !== 4) return;
      this.homography = computeHomography(saved);
      this.calibrationPoints = saved;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async start() {
    if (this.isRunning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('カメラは HTTPS または localhost で使用できます。');
    }

    const token = ++this.generation;
    this.setStatus('loading', 'カメラと足認識を準備しています…');
    try {
      const [vision, stream] = await Promise.all([
        import(/* @vite-ignore */ VISION_URL),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false,
        }),
      ]);
      if (token !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.canvas.width = this.video.videoWidth || 960;
      this.canvas.height = this.video.videoHeight || 720;
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const baseOptions = { modelAssetPath: MODEL_URL, delegate: 'GPU' };
      try {
        this.detector = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions,
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      } catch {
        this.detector = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }
      if (token !== this.generation) return;
      this.setStatus(
        this.homography ? 'ready' : 'calibrating',
        this.homography ? '足を認識しています' : '映像上で投影枠の左上から4隅を順にクリック',
      );
      this.loop(token);
    } catch (error) {
      this.stop();
      this.setStatus('error', error instanceof Error ? error.message : 'カメラを開始できませんでした');
      throw error;
    }
  }

  stop() {
    this.generation += 1;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.detector?.close?.();
    this.detector = null;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onFeet([]);
    this.setStatus('off', 'カメラは停止中です');
  }

  resetCalibration() {
    this.calibrationPoints = [];
    this.homography = null;
    localStorage.removeItem(STORAGE_KEY);
    this.setStatus('calibrating', '投影枠の左上をクリックしてください');
  }

  addCalibrationPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return this.addCalibrationPointNormalized(
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
    );
  }

  addCalibrationPointNormalized(x, y) {
    if (!this.video.videoWidth || this.calibrationPoints.length >= 4) return false;
    const point = {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
    this.calibrationPoints.push(point);
    if (this.calibrationPoints.length === 4) {
      try {
        this.homography = computeHomography(this.calibrationPoints);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calibrationPoints));
        this.setStatus('ready', '調整完了。足を認識しています');
      } catch {
        this.resetCalibration();
        this.setStatus('error', '4点が近すぎます。もう一度調整してください');
        return false;
      }
    } else {
      this.setStatus('calibrating', `次は${CORNER_LABELS[this.calibrationPoints.length]}をクリック`);
    }
    return true;
  }

  loop(token) {
    const detect = (now) => {
      if (token !== this.generation || !this.detector || !this.stream) return;
      if (
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime &&
        now - this.lastInferenceAt >= 45
      ) {
        this.lastVideoTime = this.video.currentTime;
        this.lastInferenceAt = now;
        try {
          const result = this.detector.detectForVideo(this.video, now);
          this.processResult(result.landmarks ?? []);
        } catch {
          this.onFeet([]);
        }
      }
      this.animationFrame = requestAnimationFrame(detect);
    };
    this.animationFrame = requestAnimationFrame(detect);
  }

  processResult(poses) {
    const rawFeet = [];
    poses.forEach((landmarks, poseIndex) => {
      [
        { side: 'L', ankle: 27, heel: 29, toe: 31 },
        { side: 'R', ankle: 28, heel: 30, toe: 32 },
      ].forEach(({ side, ankle, heel, toe }) => {
        const points = [landmarks[ankle], landmarks[heel], landmarks[toe]];
        if (!points.every(visible)) return;
        rawFeet.push({
          key: `${poseIndex}-${side}`,
          x: (points[1].x + points[2].x) / 2,
          y: Math.max(points[0].y, points[1].y, points[2].y),
          side,
        });
      });
    });

    const mappedFeet = this.homography
      ? rawFeet.flatMap((foot) => {
          const mapped = applyHomography(this.homography, foot);
          if (!mapped || mapped.x < -0.1 || mapped.x > 1.1 || mapped.y < -0.1 || mapped.y > 1.1) return [];
          return [{ ...mapped, key: foot.key, side: foot.side }];
        })
      : [];
    this.onFeet(mappedFeet);
    this.drawOverlay(rawFeet);
  }

  drawOverlay(rawFeet) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const context = this.context;
    context.clearRect(0, 0, width, height);

    if (this.calibrationPoints.length) {
      context.lineWidth = Math.max(3, width / 240);
      context.strokeStyle = '#59f3d5';
      context.fillStyle = '#071a20';
      context.font = `700 ${Math.max(16, width / 42)}px system-ui`;
      context.beginPath();
      this.calibrationPoints.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (this.calibrationPoints.length === 4) context.closePath();
      context.stroke();
      this.calibrationPoints.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        context.beginPath();
        context.arc(x, y, Math.max(11, width / 65), 0, Math.PI * 2);
        context.fillStyle = '#59f3d5';
        context.fill();
        context.fillStyle = '#071a20';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(index + 1), x, y);
      });
    }

    rawFeet.forEach((foot) => {
      const x = foot.x * width;
      const y = foot.y * height;
      context.beginPath();
      context.arc(x, y, Math.max(13, width / 58), 0, Math.PI * 2);
      context.fillStyle = '#ffcf4a';
      context.fill();
      context.lineWidth = Math.max(3, width / 280);
      context.strokeStyle = '#071a20';
      context.stroke();
      context.fillStyle = '#071a20';
      context.font = `900 ${Math.max(12, width / 55)}px system-ui`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(foot.side, x, y);
    });
  }

  setStatus(state, message) {
    this.onStatus({ state, message, calibrationCount: this.calibrationPoints.length });
  }
}

