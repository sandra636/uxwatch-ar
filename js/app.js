'use strict';

const state = {
  stream: null, threeScene: null, handTracker: null,
  currentWatch: 0, useFrontCam: false, rafId: null,
};

const $ = id => document.getElementById(id);
const DOM = {
  loader: $('loader'), loaderMsg: $('loader-msg'), loaderBar: $('loader-bar-fill'),
  permOverlay: $('permission-overlay'), btnAllowCam: $('btn-allow-cam'),
  app: $('app'), errorScreen: $('error-screen'), errorMsg: $('error-msg'),
  camFeed: $('camera-feed'), threeCanvas: $('three-canvas'), lmCanvas: $('landmark-canvas'),
  statusDot: $('status-dot'), statusText: $('status-text'),
  scanReticle: $('scan-reticle'), detectedBadge: $('detected-badge'),
  btnFlip: $('btn-flip'), watchThumbs: document.querySelectorAll('.watch-thumb'),
  watchNameDisplay: $('watch-name-display'),
};

function setLoader(msg, pct) {
  DOM.loaderMsg.textContent = msg;
  DOM.loaderBar.style.width = pct + '%';
}
function hideLoader() {
  DOM.loader.classList.add('fade-out');
  setTimeout(() => DOM.loader.classList.add('hidden'), 650);
}
function setStatus(type, text) {
  DOM.statusDot.className = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function showError(msg) {
  hideLoader();
  DOM.errorMsg.textContent = msg;
  DOM.errorScreen.classList.remove('hidden');
}

async function requestCamera() {
  const tries = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ];
  for (const c of tries) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ ...c, audio: false });
      const isRear = c.video.facingMode !== undefined;
      DOM.camFeed.classList.toggle('rear', isRear);
      DOM.camFeed.style.transform = isRear ? 'none' : 'scaleX(-1)';
      state.useFrontCam = !isRear;
      return s;
    } catch(e) { console.warn('camera try failed:', e); }
  }
  throw new Error('Aucune caméra disponible');
}

async function flipCamera() {
  if (state.handTracker) { state.handTracker.stop(); state.handTracker = null; }
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  const wantRear = state.useFrontCam;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: wantRear ? 'environment' : 'user' }, audio: false
    });
    state.stream = stream;
    state.useFrontCam = !wantRear;
    DOM.camFeed.classList.toggle('rear', wantRear);
    DOM.camFeed.style.transform = wantRear ? 'none' : 'scaleX(-1)';
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();
    await delay(300);
    DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
    DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;
    state.handTracker = new HandTracker(DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus);
    await state.handTracker.start(stream);
  } catch(e) { console.error('flip failed:', e); }
}

function selectWatch(index) {
  state.currentWatch = index;
  DOM.watchThumbs.forEach((b, i) => b.classList.toggle('active', i === index));
  if (DOM.watchNameDisplay) DOM.watchNameDisplay.textContent = WATCH_CATALOG[index].name;
  if (state.threeScene) state.threeScene.switchWatch(index);
}

function startARLoop() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  const loop = () => {
    state.rafId = requestAnimationFrame(loop);
    if (state.threeScene) state.threeScene.render();
  };
  loop();
}

function onWristPose(pose) {
  if (state.threeScene) state.threeScene.updateWristPose(pose);
}
function onTrackingStatus(status) {
  if (status === 'detected') {
    setStatus('active', 'Main détectée ✓');
    DOM.scanReticle.classList.add('hidden');
    DOM.detectedBadge.classList.remove('hidden');
  } else {
    setStatus('scanning', 'Montrez votre main…');
    DOM.scanReticle.classList.remove('hidden');
    DOM.detectedBadge.classList.add('hidden');
  }
}

async function startWithStream(stream) {
  state.stream = stream;
  DOM.camFeed.srcObject = stream;
  DOM.camFeed.muted = true;
  DOM.camFeed.playsInline = true;

  await new Promise(res => {
    if (DOM.camFeed.readyState >= 1) { res(); return; }
    DOM.camFeed.onloadedmetadata = res;
    setTimeout(res, 3000);
  });
  try { await DOM.camFeed.play(); } catch(e) { console.warn('play:', e); }

  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  setLoader('Activation MediaPipe…', 75);
  await delay(300);

  try {
    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch(e) { console.error('MediaPipe error:', e); }

  setLoader('Prêt !', 100);
  await delay(400);
  hideLoader();

  DOM.app.classList.remove('hidden');
  await delay(150);
  if (state.threeScene) state.threeScene.forceResize();

  startARLoop();
  setStatus('scanning', 'Montrez votre main à la caméra…');
  DOM.scanReticle.classList.remove('hidden');
}

async function init() {
  setLoader('Démarrage…', 10);
  await delay(100);

  try {
    state.threeScene = new ThreeScene(DOM.threeCanvas);
    setLoader('Modèles chargés…', 40);
  } catch(e) {
    showError('Erreur moteur 3D : ' + e.message);
    return;
  }

  setLoader('Connexion caméra…', 60);
  let stream;
  try {
    stream = await requestCamera();
  } catch(e) {
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }

  await startWithStream(stream);
}

DOM.btnAllowCam.addEventListener('click', async () => {
  DOM.permOverlay.classList.add('hidden');
  try {
    const stream = await requestCamera();
    await startWithStream(stream);
  } catch(e) {
    showError('Accès caméra refusé. Autorisez dans les paramètres.');
  }
});

DOM.btnFlip.addEventListener('click', flipCamera);
DOM.watchThumbs.forEach((b, i) => b.addEventListener('click', () => selectWatch(i)));

document.addEventListener('DOMContentLoaded', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Navigateur non supporté. Utilisez Chrome.');
    return;
  }
  init();
});