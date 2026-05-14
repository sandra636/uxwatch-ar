/**
 * app.js
 * Orchestrateur principal — LuxWatch AR
 * Gère le cycle de vie : loader → permissions → caméra → AR → UI
 */

'use strict';

/* ──────────────────────────────────────────────────────────────
   STATE
──────────────────────────────────────────────────────────────── */
const state = {
  stream:       null,
  threeScene:   null,
  handTracker:  null,
  currentWatch: 0,
  useFrontCam:  true,   // par défaut miroir; rear si disponible
  rafId:        null,
};

/* ──────────────────────────────────────────────────────────────
   DOM REFS
──────────────────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const DOM = {
  loader:       $('loader'),
  loaderMsg:    $('loader-msg'),
  loaderBar:    $('loader-bar-fill'),
  permOverlay:  $('permission-overlay'),
  btnAllowCam:  $('btn-allow-cam'),
  app:          $('app'),
  errorScreen:  $('error-screen'),
  errorMsg:     $('error-msg'),
  camFeed:      $('camera-feed'),
  threeCanvas:  $('three-canvas'),
  lmCanvas:     $('landmark-canvas'),
  statusDot:    $('status-dot'),
  statusText:   $('status-text'),
  scanReticle:  $('scan-reticle'),
  detectedBadge:$('detected-badge'),
  btnFlip:      $('btn-flip'),
  watchThumbs:  document.querySelectorAll('.watch-thumb'),
  watchNameDisplay: $('watch-name-display'),
};

/* ──────────────────────────────────────────────────────────────
   LOADER STEPS
──────────────────────────────────────────────────────────────── */
const LOAD_STEPS = [
  { msg: 'Initialisation du moteur 3D…', pct: 15 },
  { msg: 'Chargement des modèles de montres…', pct: 35 },
  { msg: 'Activation de MediaPipe Hands…', pct: 55 },
  { msg: 'Connexion à la caméra…', pct: 75 },
  { msg: 'Calibration AR…', pct: 90 },
  { msg: 'Prêt !', pct: 100 },
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

/* ──────────────────────────────────────────────────────────────
   STATUS BAR
──────────────────────────────────────────────────────────────── */
function setStatus(type, text) {
  DOM.statusDot.className  = 'status-dot ' + (type || '');
  DOM.statusText.textContent = text;
}

/* ──────────────────────────────────────────────────────────────
   CAMÉRA — WebRTC
──────────────────────────────────────────────────────────────── */
async function requestCamera(preferRear = true) {
  const constraints = {
    video: {
      facingMode: preferRear ? { ideal: 'environment' } : 'user',
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    // Vérifier si caméra arrière vraiment obtenue
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    state.useFrontCam = settings.facingMode !== 'environment';

    // Mirror uniquement pour caméra frontale
    DOM.camFeed.classList.toggle('rear', !state.useFrontCam);

    return stream;
  } catch (err) {
    // Fallback : essayer sans contrainte facingMode
    if (preferRear) {
      console.warn('Caméra arrière indisponible, fallback…', err);
      return requestCamera(false);
    }
    throw err;
  }
}

/* ──────────────────────────────────────────────────────────────
   FLIP CAMÉRA
──────────────────────────────────────────────────────────────── */
async function flipCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach(t => t.stop());
  DOM.camFeed.srcObject = null;

  try {
    const stream = await requestCamera(state.useFrontCam); // inverse
    state.stream = stream;
    DOM.camFeed.srcObject = stream;
    await DOM.camFeed.play();
  } catch (err) {
    console.error('Impossible de changer de caméra', err);
  }
}

/* ──────────────────────────────────────────────────────────────
   SÉLECTION MONTRE
──────────────────────────────────────────────────────────────── */
function selectWatch(index) {
  state.currentWatch = index;
  DOM.watchThumbs.forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });
  DOM.watchNameDisplay.textContent = WATCH_CATALOG[index].name;
  if (state.threeScene) state.threeScene.switchWatch(index);
}

/* ──────────────────────────────────────────────────────────────
   BOUCLE AR
──────────────────────────────────────────────────────────────── */
function startARLoop() {
  function loop() {
    state.rafId = requestAnimationFrame(loop);
    if (state.threeScene) state.threeScene.render();
  }
  loop();
}

/* ──────────────────────────────────────────────────────────────
   MAIN INIT
──────────────────────────────────────────────────────────────── */
async function init() {
  setLoaderStep(0);

  // ── 1. Initialiser Three.js
  await delay(200);
  state.threeScene = new ThreeScene(DOM.threeCanvas);
  setLoaderStep(1);

  // ── 2. Vérifier accès caméra
  await delay(300);
  setLoaderStep(2);

  let stream;
  try {
    stream = await requestCamera(true);
    state.stream = stream;
  } catch (err) {
    // Demander à l'utilisateur
    console.warn('getUserMedia échoué, afficher permission overlay', err);
    hideLoader();
    DOM.permOverlay.classList.remove('hidden');
    return;
  }

  await startWithStream(stream);
}

async function startWithStream(stream) {
  setLoaderStep(3);
  state.stream = stream;

  // Attacher le flux vidéo
  DOM.camFeed.srcObject = stream;
  DOM.camFeed.muted = true;

  // Attendre que la vidéo soit prête
  await new Promise(res => {
    DOM.camFeed.onloadedmetadata = res;
    if (DOM.camFeed.readyState >= 1) res();
  });

  // Synchroniser la taille du canvas landmark
  DOM.lmCanvas.width  = DOM.camFeed.videoWidth  || 640;
  DOM.lmCanvas.height = DOM.camFeed.videoHeight || 480;

  setLoaderStep(4);
  await delay(300);

  // ── 3. Lancer MediaPipe Hands
  setStatus('scanning', 'Initialisation du suivi…');

  state.handTracker = new HandTracker(
    DOM.camFeed,
    DOM.lmCanvas,
    onWristPose,
    onTrackingStatus
  );

  await state.handTracker.start(stream);

  setLoaderStep(5);
  await delay(500);

  // ── 4. Afficher l'app
  hideLoader();
  DOM.app.classList.remove('hidden');

  // Démarrer la boucle AR
  startARLoop();

  setStatus('scanning', 'Montrez votre poignet…');
  DOM.scanReticle.classList.remove('hidden');
}

/* ──────────────────────────────────────────────────────────────
   CALLBACKS MEDIAPIPE
──────────────────────────────────────────────────────────────── */
function onWristPose(pose) {
  if (state.threeScene) state.threeScene.updateWristPose(pose);
}

function onTrackingStatus(status) {
  if (status === 'detected') {
    setStatus('active', 'Poignet détecté');
    DOM.scanReticle.classList.add('hidden');
    DOM.detectedBadge.classList.remove('hidden');
  } else {
    setStatus('scanning', 'Montrez votre poignet…');
    DOM.scanReticle.classList.remove('hidden');
    DOM.detectedBadge.classList.add('hidden');
  }
}

/* ──────────────────────────────────────────────────────────────
   EVENT LISTENERS
──────────────────────────────────────────────────────────────── */
DOM.btnAllowCam.addEventListener('click', async () => {
  DOM.permOverlay.classList.add('hidden');
  try {
    const stream = await requestCamera(true);
    await startWithStream(stream);
  } catch (err) {
    $('error-msg').textContent = 'Accès caméra refusé. Veuillez autoriser dans les paramètres du navigateur.';
    $('error-screen').classList.remove('hidden');
  }
});

DOM.btnFlip.addEventListener('click', flipCamera);

DOM.watchThumbs.forEach((btn, i) => {
  btn.addEventListener('click', () => selectWatch(i));
});

/* ──────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────── */
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/* ──────────────────────────────────────────────────────────────
   LAUNCH
──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Vérifier compatibilité
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    DOM.loader.classList.add('hidden');
    $('error-msg').textContent = 'Votre navigateur ne supporte pas WebRTC. Utilisez Chrome ou Firefox récent.';
    $('error-screen').classList.remove('hidden');
    return;
  }
  init();
});
