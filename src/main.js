import './styles.css';
import { GameAudio } from './audio.js';
import { CameraFootTracker } from './camera-foot-tracker.js';
import { FootZoneDetector } from './foot-zone-detector.js';
import { MoleGame, nearestHole } from './game-core.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  game: $('#game'),
  holes: $$('.hole'),
  footLayer: $('#footLayer'),
  soundButton: $('#soundButton'),
  monitorButton: $('#monitorButton'),
  fullscreenButton: $('#fullscreenButton'),
  setupDialog: $('#setupDialog'),
  closeSetupButton: $('#closeSetupButton'),
  cameraVideo: $('#cameraVideo'),
  cameraCanvas: $('#cameraCanvas'),
  cameraPlaceholder: $('#cameraPlaceholder'),
  cameraStartButton: $('#cameraStartButton'),
  cameraResetButton: $('#cameraResetButton'),
  cameraStopButton: $('#cameraStopButton'),
  cameraBadge: $('#cameraBadge'),
  cameraStatus: $('#cameraStatus'),
  cameraStatusLight: $('#cameraStatusLight'),
};

const game = new MoleGame({
  config: {
    countdownMs: 0,
    durationMs: Number.POSITIVE_INFINITY,
  },
});
const audio = new GameAudio();
let cameraState = 'off';
const controlStorageKey = 'mogura-control-message-v1';
const controlChannel = 'BroadcastChannel' in window ? new BroadcastChannel('mogura-control-v1') : null;
let controlMessageId = 0;
const receivedControlMessages = new Set();
const footDetector = new FootZoneDetector({
  zoneAt(point) {
    return game.phase === 'running' ? nearestHole(point.x, point.y, 0.12) : null;
  },
});

function startGame() {
  if (game.phase === 'countdown' || game.phase === 'running') return;
  void audio.unlock();
  footDetector.reset();
  const now = performance.now();
  game.start(now);
  game.update(now);
  handleEvents(game.drainEvents());
  render(now);
}

function activateZone(zone) {
  if (!Number.isInteger(zone) || zone < 0 || zone >= elements.holes.length) return;
  if (game.phase !== 'running') return;
  const now = performance.now();
  game.update(now);
  game.hit(zone, now, 'camera');
  handleEvents(game.drainEvents());
  render(now);
}

function handleEvents(events) {
  events.forEach((event) => {
    if (event.type === 'go') audio.go();
    if (event.type === 'spawn') audio.spawn(event.target.kind === 'gold');
    if (event.type === 'hit') {
      const hole = elements.holes[event.target.hole];
      hole.classList.add('is-hit');
      window.setTimeout(() => hole.classList.remove('is-hit'), 430);
      audio.hit(event.target.kind === 'gold', game.combo);
    }
  });
}

function render(now) {
  const snapshot = game.snapshot(now);
  elements.game.dataset.phase = snapshot.phase;

  elements.holes.forEach((hole, index) => {
    const isTarget = snapshot.target?.hole === index;
    hole.classList.toggle('is-up', isTarget);
    hole.dataset.kind = isTarget ? snapshot.target.kind : '';
    hole.setAttribute('aria-label', isTarget ? `${index + 1}番の穴に${snapshot.target.kind === 'gold' ? '金モグラ' : 'モグラ'}が出ています` : `${index + 1}番の穴`);
  });
}

function frame(now) {
  game.update(now);
  handleEvents(game.drainEvents());
  render(now);
  requestAnimationFrame(frame);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    elements.cameraStatus.textContent = '全画面にできません。Chromeで F11 を押してください';
    elements.cameraStatusLight.className = 'error';
  }
}

function updateSoundButton() {
  elements.soundButton.setAttribute('aria-pressed', String(audio.enabled));
  elements.soundButton.querySelector('b').textContent = audio.enabled ? '音 ON' : '音 OFF';
  elements.soundButton.querySelector('span').textContent = audio.enabled ? '♪' : '×';
}

function processFootFrame(points) {
  const now = performance.now();
  const activations = footDetector.update(points, now);
  renderTrackedFeet(points);
  if (!elements.setupDialog.open) {
    activations.forEach((zone) => activateZone(zone));
  }
}

function renderTrackedFeet(points) {
  elements.footLayer.replaceChildren(...points.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).map((point) => {
    const foot = document.createElement('i');
    foot.className = 'tracked-foot';
    foot.dataset.side = point.side ?? '•';
    foot.style.left = `${point.x * 100}%`;
    foot.style.top = `${point.y * 100}%`;
    foot.style.setProperty('--angle', point.side === 'R' ? '12deg' : '-12deg');
    return foot;
  }));
}

const camera = new CameraFootTracker({
  video: elements.cameraVideo,
  canvas: elements.cameraCanvas,
  onFeet: processFootFrame,
  onStatus({ state, message, calibrationCount }) {
    cameraState = state;
    elements.cameraBadge.dataset.state = state;
    elements.cameraBadge.textContent = state === 'ready' ? 'READY' : state === 'loading' ? 'LOADING' : state === 'calibrating' ? `${calibrationCount}/4` : state === 'error' ? 'ERROR' : 'OFF';
    elements.cameraStatus.textContent = message;
    elements.cameraStatusLight.className = state;
    elements.cameraPlaceholder.hidden = state !== 'off' && state !== 'error';
  },
});

window.moguraCameraMonitor = Object.freeze({
  get stream() { return camera.stream; },
  get overlayCanvas() { return elements.cameraCanvas; },
  get state() { return cameraState; },
  get status() { return elements.cameraStatus.textContent; },
  get calibrationCount() { return camera.calibrationCount; },
  get soundEnabled() { return audio.enabled; },
  get settingsOpen() { return elements.setupDialog.open; },
  startCamera() { return camera.start(); },
  stopCamera() { camera.stop(); },
  resetCalibration() { camera.resetCalibration(); },
  addCalibrationPoint(x, y) {
    return camera.addCalibrationPointNormalized(x, y);
  },
  toggleSound() {
    void audio.unlock();
    audio.setEnabled(!audio.enabled);
    updateSoundButton();
    return audio.enabled;
  },
  toggleFullscreen,
  toggleSettings() {
    if (elements.setupDialog.open) elements.setupDialog.close();
    else elements.setupDialog.show();
    return elements.setupDialog.open;
  },
});

function controlState() {
  return {
    cameraState,
    cameraStatus: elements.cameraStatus.textContent,
    calibrationCount: camera.calibrationCount,
    soundEnabled: audio.enabled,
    settingsOpen: elements.setupDialog.open,
    hasStream: Boolean(camera.stream),
  };
}

function postControlMessage(message) {
  const packet = { ...message, id: `game-${Date.now()}-${controlMessageId += 1}` };
  controlChannel?.postMessage(packet);
  try {
    localStorage.setItem(controlStorageKey, JSON.stringify(packet));
  } catch {
    // BroadcastChannel remains the primary route when storage is unavailable.
  }
}

function sendControlState() {
  postControlMessage({ type: 'state', state: controlState() });
}

function handleControlMessage(data) {
  if (!data || receivedControlMessages.has(data.id)) return;
  if (data.id) {
    receivedControlMessages.add(data.id);
    if (receivedControlMessages.size > 200) receivedControlMessages.delete(receivedControlMessages.values().next().value);
  }
  if (data.type === 'hello') {
    sendControlState();
    return;
  }
  if (data.type !== 'command') return;
  const { command, payload } = data;
  if (command === 'camera-start') void camera.start().catch(() => {});
  else if (command === 'camera-stop') camera.stop();
  else if (command === 'calibration-reset') camera.resetCalibration();
  else if (command === 'calibration-point') camera.addCalibrationPointNormalized(payload?.x, payload?.y);
  else if (command === 'sound-toggle') {
    void audio.unlock();
    audio.setEnabled(!audio.enabled);
    updateSoundButton();
  } else if (command === 'fullscreen-toggle') {
    void toggleFullscreen();
  } else if (command === 'settings-toggle') {
    if (elements.setupDialog.open) elements.setupDialog.close();
    else elements.setupDialog.show();
  }
  sendControlState();
}

controlChannel?.addEventListener('message', (event) => handleControlMessage(event.data));
window.addEventListener('storage', (event) => {
  if (event.key !== controlStorageKey || !event.newValue) return;
  try {
    handleControlMessage(JSON.parse(event.newValue));
  } catch {
    // Ignore malformed messages from older versions.
  }
});

window.setInterval(sendControlState, 250);

elements.soundButton.addEventListener('click', () => {
  void audio.unlock();
  audio.setEnabled(!audio.enabled);
  updateSoundButton();
});
elements.fullscreenButton.addEventListener('click', toggleFullscreen);
elements.monitorButton.addEventListener('click', () => {
  const monitorUrl = new URL('./monitor.html', window.location.href);
  const monitor = window.open(monitorUrl, 'mogura-camera-monitor', 'popup,width=1100,height=760');
  if (!monitor) {
    elements.cameraStatus.textContent = '専用操作画面を開けませんでした';
    elements.cameraStatusLight.className = 'error';
  }
});
elements.closeSetupButton.addEventListener('click', () => {
  elements.setupDialog.close();
});
elements.cameraStartButton.addEventListener('click', async () => {
  void audio.unlock();
  try {
    await camera.start();
  } catch {
    // The status callback already provides the actionable message.
  }
});
elements.cameraStopButton.addEventListener('click', () => camera.stop());
elements.cameraResetButton.addEventListener('click', () => camera.resetCalibration());
elements.cameraCanvas.addEventListener('pointerdown', (event) => {
  if (cameraState !== 'calibrating') return;
  camera.addCalibrationPoint(event.clientX, event.clientY);
});

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.target instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') {
    event.preventDefault();
    if (elements.setupDialog.open) elements.setupDialog.close();
    else elements.setupDialog.show();
  } else if (key === 'm') {
    audio.setEnabled(!audio.enabled);
    updateSoundButton();
  } else if (key === 'f') {
    void toggleFullscreen();
  }
});

window.addEventListener('beforeunload', () => {
  camera.stop();
  controlChannel?.close();
});

updateSoundButton();
startGame();
requestAnimationFrame(frame);
void camera.start().catch(() => {
  // The camera button remains available when automatic startup is blocked.
});

