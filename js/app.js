/**
 * app.js — VERSION CORRIGÉE v4
 * Fix : caméra arrière forcée, pas de vérification facingMode
 */

'use strict';

const state = {
  stream:       null,
  threeScene:   null,
  handTracker:  null,
  currentWatch: 0,
  useFrontCam:  false,
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
  { msg: 'Initialisation du moteur 3D…',       pct: 15 },
  { msg: 'Chargement des modèles de montres…',  pct: 35 },
  { msg: 'Activation de MediaPipe Hands…',      pct: 55 },
  { msg: 'Connexion à la caméra…',              pct: 75 },
  { msg: 'Calibration AR…',                     pct: 90 },
  { msg: 'Prêt !',                              pct: 100 },
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
  DOM.statusDot.className    = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}

/* ── Caméra ──────────────────────────────────────────────────── */
async function requestCamera(wantRear) {
  const constraints = {
    video: {
      facingMode: wantRear ? 'environment' : 'user',
      width:      { ideal: 1280 },
      height:     { ideal: 720 },
      frameRate:  { ideal: 30 },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    // On fait confiance à ce qu'on a demandé — pas de vérification facingMode
    state.useFrontCam = !wantRear;
    DOM.camFeed.classList.toggle('rear', wantRear);
    return stream;
  } catch (err) {
    console.warn('Contrainte facingMode échouée, fallback sans contrainte', err);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    state.useFrontCam = true;
    DOM.camFeed.classList.remove('rear');
    return stream;
  }
}

/* ── Flip caméra ─────────────────────────────────────────────── */
async function flipCamera() {
  if (!state.stream) return;

  if (state.handTracker) {
    state.handTracker.stop();
    state.handTracker = null;
  }
  state.stream.getTracks().forEach(t => t.stop());
  DOM.camFeed.srcObject = null;

  // Inverser : si on était en frontale → arrière, et vice versa
  const wantRear = state.useFrontCam;

  try {
    const stream = await requestCamera(wantRear);
    state.stream = stream;
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();

    await delay(300);
    DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
    DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (err) {
    console.error('Impossible de changer de caméra :', err);
    setStatus('', 'Changement de caméra impossible');
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

  try {
    state.threeScene = new ThreeScene(DOM.threeCanvas);
  } catch (e) {
    console.error('Erreur Three.js :', e);
    showError('Erreur de chargement 3D. Rechargez la page.');
    return;
  }
  setLoaderStep(1);
  await delay(300);
  setLoaderStep(2);

  let stream;
  try {
    stream = await requestCamera(true); // true = caméra arrière
    state.stream = stream;
  } catch (err) {
    console.warn('getUserMedia échoué :', err);
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }

  await startWithStream(stream);
}

async function startWithStream(stream) {
  setLoaderStep(3);
  state.stream = stream;

  DOM.camFeed.srcObject   = stream;
  DOM.camFeed.muted       = true;
  DOM.camFeed.playsInline = true;

  await new Promise(res => {
    if (DOM.camFeed.readyState >= 1) { res(); return; }
    DOM.camFeed.onloadedmetadata = res;
  });

  try {
    await DOM.camFeed.play();
  } catch (e) {
    console.warn('play() bloqué :', e);
  }

  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  setLoaderStep(4);
  await delay(400);

  setStatus('scanning', 'Initialisation du suivi…');
  try {
    state.handTracker = new HandTracker(
      DOM.camFeed, DOM.lmCanvas, onWristPose, onTrackingStatus
    );
    await state.handTracker.start(stream);
  } catch (e) {
    console.error('Erreur MediaPipe :', e);
    setStatus('', 'Erreur détection — rechargez');
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