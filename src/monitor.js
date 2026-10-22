const video = document.querySelector('#monitorVideo');
const canvas = document.querySelector('#monitorCanvas');
const context = canvas.getContext('2d');
const status = document.querySelector('.status');
const statusText = document.querySelector('#statusText');
const emptyState = document.querySelector('#emptyState');
const cameraStartButton = document.querySelector('#cameraStartButton');
const cameraResetButton = document.querySelector('#cameraResetButton');
const cameraStopButton = document.querySelector('#cameraStopButton');
const calibrationStatus = document.querySelector('#calibrationStatus');
const soundButton = document.querySelector('#soundButton');
const fullscreenButton = document.querySelector('#fullscreenButton');
const settingsButton = document.querySelector('#settingsButton');
const controlStorageKey = 'mogura-control-message-v1';
const controlChannel = 'BroadcastChannel' in window ? new BroadcastChannel('mogura-control-v1') : null;
let controlMessageId = 0;
const receivedControlMessages = new Set();
let remoteState = null;
let fallbackStream = null;
let fallbackCameraPending = false;

function source() {
  return window.opener?.moguraCameraMonitor ?? null;
}

function postControlMessage(message) {
  const packet = { ...message, id: `operator-${Date.now()}-${controlMessageId += 1}` };
  controlChannel?.postMessage(packet);
  try {
    localStorage.setItem(controlStorageKey, JSON.stringify(packet));
  } catch {
    // BroadcastChannel remains the primary route when storage is unavailable.
  }
}

function sendCommand(command, action, payload) {
  const game = source();
  if (game) {
    try {
      const result = action(game);
      if (result && typeof result.then === 'function') void result.catch(() => {});
      return;
    } catch {
      // Fall back to BroadcastChannel when direct window access is unavailable.
    }
  }
  postControlMessage({ type: 'command', command, payload });
}

cameraStartButton.addEventListener('click', () => sendCommand('camera-start', (game) => game.startCamera()));
cameraResetButton.addEventListener('click', () => sendCommand('calibration-reset', (game) => game.resetCalibration()));
cameraStopButton.addEventListener('click', () => sendCommand('camera-stop', (game) => game.stopCamera()));
soundButton.addEventListener('click', () => sendCommand('sound-toggle', (game) => game.toggleSound()));
fullscreenButton.addEventListener('click', () => sendCommand('fullscreen-toggle', (game) => game.toggleFullscreen()));
settingsButton.addEventListener('click', () => sendCommand('settings-toggle', (game) => game.toggleSettings()));

function handleControlMessage(data) {
  if (!data || receivedControlMessages.has(data.id)) return;
  if (data.id) {
    receivedControlMessages.add(data.id);
    if (receivedControlMessages.size > 200) receivedControlMessages.delete(receivedControlMessages.values().next().value);
  }
  if (data.type === 'state') remoteState = data.state;
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
postControlMessage({ type: 'hello' });

async function ensureFallbackCamera() {
  if (fallbackStream || fallbackCameraPending || !navigator.mediaDevices?.getUserMedia) return;
  fallbackCameraPending = true;
  try {
    fallbackStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {
    fallbackStream = null;
  } finally {
    fallbackCameraPending = false;
  }
}

function stopFallbackCamera() {
  fallbackStream?.getTracks().forEach((track) => track.stop());
  fallbackStream = null;
}

canvas.addEventListener('pointerdown', (event) => {
  const game = source();
  const state = game?.state ?? remoteState?.cameraState;
  if (state !== 'calibrating' || !canvas.width || !canvas.height) return;
  const rect = canvas.getBoundingClientRect();
  const sourceAspect = canvas.width / canvas.height;
  const boxAspect = rect.width / rect.height;
  let width = rect.width;
  let height = rect.height;
  let left = 0;
  let top = 0;
  if (boxAspect > sourceAspect) {
    width = height * sourceAspect;
    left = (rect.width - width) / 2;
  } else {
    height = width / sourceAspect;
    top = (rect.height - height) / 2;
  }
  const x = (event.clientX - rect.left - left) / width;
  const y = (event.clientY - rect.top - top) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  sendCommand('calibration-point', (current) => current.addCalibrationPoint(x, y), { x, y });
});

function frame() {
  const game = source();
  const state = game ? {
    cameraState: game.state,
    cameraStatus: game.status,
    calibrationCount: game.calibrationCount,
    soundEnabled: game.soundEnabled,
    settingsOpen: game.settingsOpen,
    hasStream: Boolean(game.stream),
  } : remoteState;
  if (!state) {
    status.dataset.state = 'error';
    statusText.textContent = 'CONNECTING';
    emptyState.hidden = false;
    document.body.dataset.cameraState = 'loading';
    document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    requestAnimationFrame(frame);
    return;
  }

  status.dataset.state = state.cameraState;
  statusText.textContent = state.cameraStatus || state.cameraState.toUpperCase();
  document.body.dataset.cameraState = state.cameraState;
  document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  cameraStartButton.disabled = state.cameraState === 'loading' || state.hasStream;
  cameraStopButton.disabled = !state.hasStream;
  soundButton.textContent = state.soundEnabled ? '音 ON' : '音 OFF';
  settingsButton.textContent = state.settingsOpen ? '設定を隠す' : '設定を表示';
  calibrationStatus.textContent = state.cameraState === 'calibrating'
    ? `映像上で投影範囲の4隅を順にクリック（${state.calibrationCount}/4）`
    : '投影範囲と足の認識位置を確認できます';

  const stream = game?.stream ?? fallbackStream;
  if (!game && state.hasStream && !fallbackStream) void ensureFallbackCamera();
  if (!state.hasStream && fallbackStream) stopFallbackCamera();
  if (stream && video.srcObject !== stream) {
    video.srcObject = stream;
    void video.play().catch(() => {});
  }
  if (!stream && video.srcObject) video.srcObject = null;

  const overlay = game?.overlayCanvas;
  if (overlay?.width && overlay?.height) {
    if (canvas.width !== overlay.width || canvas.height !== overlay.height) {
      canvas.width = overlay.width;
      canvas.height = overlay.height;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(overlay, 0, 0);
  }
  emptyState.hidden = Boolean(stream);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  stopFallbackCamera();
  controlChannel?.close();
});

