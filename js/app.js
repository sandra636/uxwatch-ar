/**
 * app.js — VERSION CORRIGÉE
 * Corrections :
 *  - Vidéo play() avant MediaPipe
 *  - Debug canvas visible par défaut pour vérifier la détection
 *  - Gestion d'erreurs améliorée
 */

'use strict';

const state = {
  stream:       null,
  threeScene:   null,
  handTracker:  null,
  currentWatch: 0,
  useFrontCam:  false, // CORRIGÉ : false = essayer caméra arrière en premier
  rafId:        null,
};

const $  = id => document.getElementById(id);
const DOM = {
  loader:        $('loader'),
  loaderMsg:     $('loader-msg'),
  loaderBar:     $('loader-bar-fill'),
  permOverlay:   $('permission-overlay'),
  btnAllowCam:   $('btn-allow-cam'),
  app:           $('app'),
  errorScreen:   $('error-screen'),
  errorMsg:      $('error-msg'),
  camFeed:       $('camera-feed'),
  threeCanvas:   $('three-canvas'),
  lmCanvas:      $('landmark-canvas'),
  statusDot:     $('status-dot'),
  statusText:    $('status-text'),
  scanReticle:   $('scan-reticle'),
  detectedBadge: $('detected-badge'),
  btnFlip:       $('btn-flip'),
  watchThumbs:   document.querySelectorAll('.watch-thumb'),
  watchNameDisplay: $('watch-name-display'),
};

const LOAD_STEPS = [
  { msg: 'Initialisation du moteur 3D…',      pct: 15 },
  { msg: 'Chargement des modèles de montres…', pct: 35 },
  { msg: 'Activation de MediaPipe Hands…',     pct: 55 },
  { msg: 'Connexion à la caméra…',             pct: 75 },
  { msg: 'Calibration AR…',                    pct: 90 },
  { msg: 'Prêt !',                             pct: 100 },
];

function setLoaderStep(index) {
  const step = LOAD_STEPS[index];
  if (!step) return;
  DOM.loaderMsg.textContent = step.msg;
  DOM.loaderBar.style.width = step.pct + '%';
}

function hideLoader() {
  DOM.loader.classList.add('fade-out');
  setTimeout(() => DOM.loader.classList.add('hidden'), 650);
}

function setStatus(type, text) {
  DOM.statusDot.className   = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}

/* ── Caméra ──────────────────────────────────────────────────── */
async function requestCamera(preferRear = true) {
  const constraints = {
    video: {
      facingMode: preferRear ? 'environment' : 'user',
      width:      { ideal: 1280 },
      height:     { ideal: 720 },
      frameRate:  { ideal: 30 },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track    = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    state.useFrontCam = settings.facingMode !== 'environment';
    DOM.camFeed.classList.toggle('rear', !state.useFrontCam);
    return stream;
  } catch (err) {
    if (preferRear) {
      console.warn('Caméra arrière indisponible, fallback…', err);
      return requestCamera(false);
    }
    throw err;
  }
}

async function flipCamera() {
  if (!state.stream) return;
  if (state.handTracker) state.handTracker.stop();
  state.stream.getTracks().forEach(t => t.stop());
  DOM.camFeed.srcObject = null;

  try {
    const stream = await requestCamera(state.useFrontCam);
    state.stream  = stream;
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();

    // Relancer le tracker avec le nouveau flux
    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (err) {
    console.error('Impossible de changer de caméra', err);
  }
}

/* ── Sélection montre ────────────────────────────────────────── */
function selectWatch(index) {
  state.currentWatch = index;
  DOM.watchThumbs.forEach((btn, i) => btn.classList.toggle('active', i === index));
  DOM.watchNameDisplay.textContent = WATCH_CATALOG[index].name;
  if (state.threeScene) state.threeScene.switchWatch(index);
}

/* ── Boucle AR ───────────────────────────────────────────────── */
function startARLoop() {
  function loop() {
    state.rafId = requestAnimationFrame(loop);
    if (state.threeScene) state.threeScene.render();
  }
  loop();
}

/* ── Init principale ─────────────────────────────────────────── */
async function init() {
  setLoaderStep(0);
  await delay(200);

  // 1. Three.js
  try {
    state.threeScene = new ThreeScene(DOM.threeCanvas);
  } catch (e) {
    console.error('Erreur Three.js:', e);
    showError('Erreur de chargement 3D. Rechargez la page.');
    return;
  }
  setLoaderStep(1);
  await delay(300);
  setLoaderStep(2);

  // 2. Caméra
  let stream;
  try {
    stream = await requestCamera(true);
    state.stream = stream;
  } catch (err) {
    console.warn('getUserMedia échoué:', err);
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }

  await startWithStream(stream);
}

async function startWithStream(stream) {
  setLoaderStep(3);
  state.stream = stream;

  DOM.camFeed.srcObject = stream;
  DOM.camFeed.muted = true;
  DOM.camFeed.playsInline = true;

  // Attendre metadata
  await new Promise(res => {
    if (DOM.camFeed.readyState >= 1) { res(); return; }
    DOM.camFeed.onloadedmetadata = res;
  });

  // Jouer la vidéo AVANT MediaPipe
  try {
    await DOM.camFeed.play();
  } catch(e) {
    console.warn('play() échoué (autoplay bloqué?):', e);
  }

  // Sync canvas debug
  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  // Rendre le canvas debug visible pour voir les landmarks
  DOM.lmCanvas.style.opacity = '1';
  DOM.lmCanvas.style.display = 'block';

  setLoaderStep(4);
  await delay(400);

  // 3. MediaPipe
  setStatus('scanning', 'Initialisation du suivi…');
  try {
    state.handTracker = new HandTracker(
      DOM.camFeed,
      DOM.lmCanvas,
      onWristPose,
      onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (e) {
    console.error('Erreur MediaPipe:', e);
    setStatus('', 'Erreur de détection — rechargez');
  }

  setLoaderStep(5);
  await delay(400);

  hideLoader();
  DOM.app.classList.remove('hidden');
  startARLoop();

  setStatus('scanning', 'Montrez votre main à la caméra…');
  DOM.scanReticle.classList.remove('hidden');
}

/* ── Callbacks MediaPipe ─────────────────────────────────────── */
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

function showError(msg) {
  hideLoader();
  DOM.errorMsg.textContent = msg;
  DOM.errorScreen.classList.remove('hidden');
}

/* ── Events ──────────────────────────────────────────────────── */
DOM.btnAllowCam.addEventListener('click', async () => {
  DOM.permOverlay.classList.add('hidden');
  try {
    const stream = await requestCamera(true);
    await startWithStream(stream);
  } catch (err) {
    showError('Accès caméra refusé. Autorisez dans les paramètres du navigateur.');
  }
});

DOM.btnFlip.addEventListener('click', flipCamera);

DOM.watchThumbs.forEach((btn, i) => {
  btn.addEventListener('click', () => selectWatch(i));
});

/* ── Helpers ─────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/* ── Lancement ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    DOM.loader.classList.add('hidden');
    showError('Votre navigateur ne supporte pas WebRTC. Utilisez Chrome récent.');
    return;
  }
  init();
});
